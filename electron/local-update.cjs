/*
 * In-app updates for the local T3Learn edition (owner, 2026-10-28).
 *
 * The signed LearnHarness edition updates through electron-updater and
 * Squirrel.Mac. Squirrel refuses an unsigned app, and the local edition is
 * ad-hoc signed only, so it needs its own path. This module is that path.
 *
 * The feed is one JSON file on a rolling GitHub prerelease (the
 * `local-latest` tag, written by scripts/publish-local-build.mjs from the
 * GitHub Actions build of every push to main). It names one zip per
 * platform with its size and sha512. Builds are compared by build number:
 * a hand-built app carries build 0, so the first CI build always wins.
 *
 * Flow: check → "available" → the sidebar pill downloads on click →
 * verify the hash → unpack with ditto next to the temp dir → "downloaded"
 * → "Restart to update" writes a small shell script, starts it detached,
 * and quits. The script waits for this process to exit, moves the old
 * bundle aside, moves the new one into place, clears the quarantine flag
 * and opens the app again. Failure restores the old bundle.
 *
 * Everything that touches the world (fetch, fs, spawn, quit) is injected
 * so tests/local-update.test.ts can run the real logic against a local
 * HTTP server and a scratch directory.
 */
"use strict";

const crypto = require("node:crypto");
const nodeFs = require("node:fs");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { spawn: nodeSpawn } = require("node:child_process");

const PLATFORM_KEY = `${process.platform}-${process.arch}`;

/** Validate the feed document. Throws a plain Error with a readable message. */
function parseManifest(input, platformKey = PLATFORM_KEY) {
	const doc = typeof input === "string" ? JSON.parse(input) : input;
	if (!doc || typeof doc !== "object") throw new Error("update feed is not an object");
	if (typeof doc.version !== "string" || !doc.version) throw new Error("update feed has no version");
	const build = Number(doc.build);
	if (!Number.isInteger(build) || build < 0) throw new Error("update feed has no build number");
	const assets = doc.assets && typeof doc.assets === "object" ? doc.assets : {};
	const asset = assets[platformKey];
	if (!asset) throw new Error(`update feed has no build for ${platformKey}`);
	for (const key of ["name", "url", "sha512"]) {
		if (typeof asset[key] !== "string" || !asset[key]) throw new Error(`update feed asset lacks ${key}`);
	}
	if (!/^[0-9a-f]{128}$/i.test(asset.sha512)) throw new Error("update feed sha512 is malformed");
	if (!/^https:\/\//.test(asset.url) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(asset.url)) throw new Error("update feed url must be https");
	return {
		version: doc.version,
		build,
		commit: typeof doc.commit === "string" ? doc.commit : "",
		builtAt: typeof doc.builtAt === "string" ? doc.builtAt : "",
		notes: typeof doc.notes === "string" ? doc.notes : "",
		asset: { name: asset.name, url: asset.url, sha512: asset.sha512.toLowerCase(), size: Number(asset.size) || 0 },
	};
}

/** Newer means a higher build number. Equal builds are the same app. */
function isNewer(manifest, current) {
	return manifest.build > (Number(current?.build) || 0);
}

/** The .app bundle that owns a running executable, or a reason it cannot be replaced. */
function bundlePathFromExe(exePath) {
	const bundle = path.resolve(exePath, "..", "..", "..");
	if (!bundle.endsWith(".app")) throw new Error(`not running from an app bundle: ${exePath}`);
	if (bundle.includes("/AppTranslocation/")) throw new Error("macOS is running the app from a quarantine copy. Move T3Learn.app into Applications, open it from there, and update again.");
	return bundle;
}

/** The detached helper. POSIX sh only; every tool it needs ships with macOS. */
function swapScript() {
	return `#!/bin/sh
# T3Learn update helper: wait for the app to exit, swap the bundle, relaunch.
set -u
# A stray ELECTRON_RUN_AS_NODE (shells spawned by Electron apps export it)
# would turn the relaunched app into a bare Node that exits at once.
unset ELECTRON_RUN_AS_NODE
pid="$1"; staged="$2"; target="$3"; logfile="$4"; launcher="\${5:-open}"
say() { printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$logfile" 2>/dev/null; }
i=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.2
  i=$((i + 1))
  if [ "$i" -gt 300 ]; then say "app still running after 60s, giving up"; exit 1; fi
done
backup="\${target%.app}.previous.app"
rm -rf "$backup"
if [ -e "$target" ]; then
  if ! mv "$target" "$backup"; then say "could not move the old app aside"; "$launcher" "$target"; exit 1; fi
fi
if mv "$staged" "$target" 2>/dev/null || ditto "$staged" "$target"; then
  if command -v xattr >/dev/null 2>&1; then xattr -dr com.apple.quarantine "$target" 2>/dev/null; fi
  rm -rf "$backup"
  say "installed $target"
else
  say "install failed, restoring the old app"
  rm -rf "$target"
  mv "$backup" "$target"
fi
"$launcher" "$target"
`;
}

function defaultExtract(zipFile, dir, spawn = nodeSpawn) {
	return new Promise((resolve, reject) => {
		const child = spawn("/usr/bin/ditto", ["-x", "-k", zipFile, dir], { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
		child.on("error", reject);
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ditto exited ${code}: ${stderr.trim()}`))));
	});
}

/**
 * @param deps {{
 *   feedUrl: string,
 *   current: { version: string, build: number, commit: string },
 *   exePath: string,
 *   tempDir: string,
 *   logFile: string,
 *   log: (line: string) => void,
 *   onState: (state: object) => void,
 *   quit: () => void,
 *   fetch?: typeof fetch, fs?: typeof nodeFs, spawn?: typeof nodeSpawn,
 *   extract?: (zip: string, dir: string) => Promise<void>,
 *   platformKey?: string, pid?: number, launcher?: string,
 * }}
 */
function createLocalUpdater(deps) {
	const fs = deps.fs ?? nodeFs;
	const spawn = deps.spawn ?? nodeSpawn;
	const doFetch = deps.fetch ?? globalThis.fetch;
	const extract = deps.extract ?? ((zip, dir) => defaultExtract(zip, dir, spawn));
	const platformKey = deps.platformKey ?? PLATFORM_KEY;
	const stagingDir = path.join(deps.tempDir, "t3learn-update");
	const current = { version: deps.current.version, build: Number(deps.current.build) || 0, commit: deps.current.commit ?? "" };

	let state = { status: "idle", version: null, build: null, notes: null, percent: null, message: null, retry: null, current };
	let manifest = null;
	let stagedApp = null;
	let inFlight = null;

	function setState(next) {
		state = { ...state, ...next, current };
		try {
			deps.onState(state);
		} catch (err) {
			deps.log(`state listener failed: ${err?.message ?? err}`);
		}
		return state;
	}

	async function fetchManifest() {
		const res = await doFetch(deps.feedUrl, { redirect: "follow", cache: "no-store", headers: { "user-agent": "T3Learn-updater", accept: "application/json" } });
		if (!res.ok) throw new Error(`feed answered ${res.status}`);
		return parseManifest(await res.text(), platformKey);
	}

	async function check({ manual = false } = {}) {
		if (state.status === "downloading" || state.status === "downloaded") return state;
		if (inFlight) return inFlight;
		const before = state.status;
		setState({ status: "checking", message: null, retry: null });
		inFlight = (async () => {
			try {
				const found = await fetchManifest();
				if (isNewer(found, current)) {
					manifest = found;
					deps.log(`update available: ${found.version} build ${found.build} (running build ${current.build})`);
					return setState({ status: "available", version: found.version, build: found.build, notes: found.notes || null, percent: null, message: null, retry: null });
				}
				deps.log(`up to date: feed build ${found.build}, running build ${current.build}`);
				manifest = null;
				return setState({ status: "idle", version: null, build: null, notes: null, percent: null, message: null, retry: null });
			} catch (err) {
				const message = err?.message ?? String(err);
				deps.log(`check failed: ${message}`);
				// A silent background check never shouts: only a manual check
				// surfaces the error (the menu shows it in a dialog).
				if (manual) return setState({ status: "error", message, retry: "check" });
				return setState({ status: before === "available" ? "available" : "idle" });
			} finally {
				inFlight = null;
			}
		})();
		return inFlight;
	}

	async function downloadAndVerify(asset, file) {
		const res = await doFetch(asset.url, { redirect: "follow", cache: "no-store", headers: { "user-agent": "T3Learn-updater" } });
		if (!res.ok || !res.body) throw new Error(`download answered ${res.status}`);
		const total = Number(res.headers.get("content-length")) || asset.size || 0;
		const hash = crypto.createHash("sha512");
		let received = 0;
		let lastPercent = -1;
		const meter = new Transform({
			transform(chunk, _enc, done) {
				hash.update(chunk);
				received += chunk.length;
				if (total > 0) {
					const percent = Math.min(99, Math.floor((received / total) * 100));
					if (percent !== lastPercent) {
						lastPercent = percent;
						setState({ status: "downloading", percent });
					}
				}
				done(null, chunk);
			},
		});
		await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(file));
		const digest = hash.digest("hex");
		if (digest !== asset.sha512) throw new Error("the downloaded file did not match its checksum");
		return received;
	}

	async function download() {
		if (state.status === "downloading") return inFlight ?? state;
		if (state.status === "downloaded" && stagedApp) return state;
		if (!manifest) {
			await check({ manual: true });
			if (!manifest) return state;
		}
		const target = manifest;
		setState({ status: "downloading", version: target.version, build: target.build, percent: 0, message: null, retry: null });
		inFlight = (async () => {
			try {
				fs.rmSync(stagingDir, { recursive: true, force: true });
				fs.mkdirSync(stagingDir, { recursive: true });
				const zipFile = path.join(stagingDir, target.asset.name);
				const bytes = await downloadAndVerify(target.asset, zipFile);
				deps.log(`downloaded ${target.asset.name} (${bytes} bytes), checksum ok`);
				const unpackDir = path.join(stagingDir, "unpacked");
				fs.mkdirSync(unpackDir, { recursive: true });
				await extract(zipFile, unpackDir);
				const app = fs.readdirSync(unpackDir).find((name) => name.endsWith(".app"));
				if (!app) throw new Error("the update archive holds no .app bundle");
				const appPath = path.join(unpackDir, app);
				if (!fs.existsSync(path.join(appPath, "Contents", "Info.plist"))) throw new Error("the unpacked app is incomplete");
				fs.rmSync(zipFile, { force: true });
				stagedApp = appPath;
				deps.log(`staged ${appPath}`);
				return setState({ status: "downloaded", percent: 100, message: null, retry: null });
			} catch (err) {
				const message = err?.message ?? String(err);
				deps.log(`download failed: ${message}`);
				stagedApp = null;
				fs.rmSync(stagingDir, { recursive: true, force: true });
				return setState({ status: "error", message, retry: "download" });
			} finally {
				inFlight = null;
			}
		})();
		return inFlight;
	}

	async function install() {
		if (state.status !== "downloaded" || !stagedApp) {
			deps.log("install asked before an update was staged");
			return state;
		}
		try {
			const bundle = bundlePathFromExe(deps.exePath);
			const script = path.join(stagingDir, "swap.sh");
			fs.writeFileSync(script, swapScript(), { mode: 0o755 });
			fs.mkdirSync(path.dirname(deps.logFile), { recursive: true });
			const args = [script, String(deps.pid ?? process.pid), stagedApp, bundle, deps.logFile, deps.launcher ?? "open"];
			// The helper outlives us and relaunches the app: hand it a clean
			// environment (no ELECTRON_RUN_AS_NODE, see the script).
			const { ELECTRON_RUN_AS_NODE: _dropped, ...env } = process.env;
			const child = spawn("/bin/sh", args, { detached: true, stdio: "ignore", env });
			child.unref?.();
			deps.log(`helper started for ${bundle}; quitting`);
			deps.quit();
			return state;
		} catch (err) {
			const message = err?.message ?? String(err);
			deps.log(`install failed: ${message}`);
			return setState({ status: "error", message, retry: "download" });
		}
	}

	return {
		state: () => state,
		check,
		download,
		install,
	};
}

module.exports = { PLATFORM_KEY, parseManifest, isNewer, bundlePathFromExe, swapScript, createLocalUpdater };
