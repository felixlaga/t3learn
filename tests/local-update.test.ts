/**
 * The local edition's updater (electron/local-update.cjs), run for real
 * against a loopback HTTP feed and a scratch directory. Only the world is
 * stubbed: the zip unpack (a fake bundle appears), the helper spawn (its
 * arguments are recorded) and quit. The helper script itself runs once on
 * disk against two fake bundles.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it, before, after } from "node:test";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { parseManifest, isNewer, bundlePathFromExe, swapScript, createLocalUpdater } = require("../electron/local-update.cjs") as typeof import("../electron/local-update.cjs");

const PLATFORM = "darwin-arm64";
const ZIP_NAME = "T3Learn-0.4.0-arm64-mac.zip";
const ZIP_BYTES = Buffer.alloc(300_000, 7);
const SHA = createHash("sha512").update(ZIP_BYTES).digest("hex");

function manifest(overrides: Record<string, unknown> = {}, base: string) {
	return {
		edition: "t3learn-local",
		version: "0.4.0",
		build: 12,
		commit: "abcdef1234567890",
		builtAt: "2026-10-28T10:00:00.000Z",
		notes: "Teach the agents to explain plainly",
		assets: { [PLATFORM]: { name: ZIP_NAME, url: `${base}/${ZIP_NAME}`, size: ZIP_BYTES.length, sha512: SHA } },
		...overrides,
	};
}

describe("local updater: pure parts", () => {
	it("parses a sound manifest and rejects a broken one", () => {
		const base = "https://github.com/x/y/releases/download/local-latest";
		const parsed = parseManifest(JSON.stringify(manifest({}, base)), PLATFORM);
		assert.equal(parsed.build, 12);
		assert.equal(parsed.asset.name, ZIP_NAME);
		assert.throws(() => parseManifest(JSON.stringify(manifest({ assets: {} }, base)), PLATFORM), /no build for darwin-arm64/);
		assert.throws(() => parseManifest(JSON.stringify(manifest({ build: "x" }, base)), PLATFORM), /build number/);
		const bad = manifest({}, base) as { assets: Record<string, { sha512: string }> };
		bad.assets[PLATFORM]!.sha512 = "nope";
		assert.throws(() => parseManifest(JSON.stringify(bad), PLATFORM), /sha512/);
		const plain = manifest({}, "http://example.com");
		assert.throws(() => parseManifest(JSON.stringify(plain), PLATFORM), /https/);
	});

	it("a higher build number is newer; a hand build (0) accepts any CI build", () => {
		const base = "https://example.com";
		const m = parseManifest(JSON.stringify(manifest({}, base)), PLATFORM);
		assert.equal(isNewer(m, { build: 0 }), true);
		assert.equal(isNewer(m, { build: 11 }), true);
		assert.equal(isNewer(m, { build: 12 }), false);
		assert.equal(isNewer(m, { build: 13 }), false);
	});

	it("finds the bundle from the executable and refuses a translocated copy", () => {
		assert.equal(bundlePathFromExe("/Users/f/Applications/T3Learn.app/Contents/MacOS/T3Learn"), "/Users/f/Applications/T3Learn.app");
		assert.throws(() => bundlePathFromExe("/private/var/folders/x/AppTranslocation/abc/d/T3Learn.app/Contents/MacOS/T3Learn"), /Applications/);
		assert.throws(() => bundlePathFromExe("/usr/local/bin/node"), /app bundle/);
	});
});

describe("local updater: check, download, install", () => {
	let server: http.Server;
	let base = "";
	let feedBody: () => string;
	let zipBody: () => Buffer;

	before(async () => {
		server = http.createServer((req, res) => {
			if (req.url === "/local-latest.json") {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(feedBody());
			} else if (req.url === `/${ZIP_NAME}`) {
				const body = zipBody();
				res.writeHead(200, { "content-type": "application/zip", "content-length": String(body.length) });
				res.end(body);
			} else {
				res.writeHead(404);
				res.end();
			}
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const { port } = server.address() as { port: number };
		base = `http://127.0.0.1:${port}`;
	});
	after(() => server.close());

	function harness(current = { version: "0.3.7", build: 0, commit: "old" }) {
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-update-"));
		const states: Array<Record<string, unknown>> = [];
		const spawns: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> = [];
		const logs: string[] = [];
		let quits = 0;
		type Deps = Parameters<typeof createLocalUpdater>[0];
		const updater = createLocalUpdater({
			feedUrl: `${base}/local-latest.json`,
			current,
			exePath: path.join(temp, "Applications", "T3Learn.app", "Contents", "MacOS", "T3Learn"),
			tempDir: temp,
			logFile: path.join(temp, "logs", "update.log"),
			log: (line: string) => logs.push(line),
			onState: (s: object) => { states.push({ ...(s as Record<string, unknown>) }); },
			quit: () => { quits += 1; },
			platformKey: PLATFORM,
			launcher: "true",
			extract: async (_zip: string, dir: string) => {
				fs.mkdirSync(path.join(dir, "T3Learn.app", "Contents"), { recursive: true });
				fs.writeFileSync(path.join(dir, "T3Learn.app", "Contents", "Info.plist"), "new");
			},
			spawn: ((cmd: string, args: string[], opts: Record<string, unknown>) => {
				spawns.push({ cmd, args, opts });
				return { unref() {} };
			}) as unknown as Deps["spawn"],
		} as Deps);
		return { temp, states, spawns, logs, updater, quits: () => quits, cleanup: () => fs.rmSync(temp, { recursive: true, force: true }) };
	}

	it("walks available → downloading → downloaded → install, verifying the checksum", async () => {
		feedBody = () => JSON.stringify(manifest({}, base));
		zipBody = () => ZIP_BYTES;
		const h = harness();
		try {
			const checked = await h.updater.check();
			assert.equal(checked.status, "available");
			assert.equal(checked.version, "0.4.0");
			assert.equal(checked.build, 12);
			assert.equal(checked.notes, "Teach the agents to explain plainly");

			const downloaded = await h.updater.download();
			assert.equal(downloaded.status, "downloaded", JSON.stringify(downloaded));
			const percents = h.states.filter((s) => s.status === "downloading").map((s) => s.percent as number);
			assert.ok(percents.length >= 1 && percents[0] === 0, "download progress starts at 0");
			assert.ok(percents.every((p, i) => i === 0 || p >= percents[i - 1]!), "progress only climbs");
			assert.equal(fs.existsSync(path.join(h.temp, "t3learn-update", ZIP_NAME)), false, "the zip is deleted after unpacking");

			await h.updater.install();
			assert.equal(h.spawns.length, 1);
			const [call] = h.spawns;
			assert.equal(call!.cmd, "/bin/sh");
			const [script, pid, staged, target, logFile, launcher] = call!.args;
			assert.ok(fs.existsSync(script!), "the helper script is written");
			assert.equal(pid, String(process.pid));
			assert.equal(staged, path.join(h.temp, "t3learn-update", "unpacked", "T3Learn.app"));
			assert.equal(target, path.join(h.temp, "Applications", "T3Learn.app"));
			assert.equal(logFile, path.join(h.temp, "logs", "update.log"));
			assert.equal(launcher, "true");
			assert.equal(call!.opts.detached, true);
			assert.equal(h.quits(), 1, "the app quits so the helper can swap the bundle");
		} finally {
			h.cleanup();
		}
	});

	it("a checksum mismatch ends in a retryable error and leaves nothing staged", async () => {
		feedBody = () => JSON.stringify(manifest({}, base));
		zipBody = () => Buffer.alloc(300_000, 9);
		const h = harness();
		try {
			await h.updater.check();
			const result = await h.updater.download();
			assert.equal(result.status, "error");
			assert.equal(result.retry, "download");
			assert.match(String(result.message), /checksum/);
			assert.equal(fs.existsSync(path.join(h.temp, "t3learn-update")), false);
			const installed = await h.updater.install();
			assert.equal(installed.status, "error", "install without a staged app is refused");
			assert.equal(h.spawns.length, 0);
		} finally {
			h.cleanup();
		}
	});

	it("an equal build is up to date; background failures stay silent, manual ones surface", async () => {
		feedBody = () => JSON.stringify(manifest({}, base));
		zipBody = () => ZIP_BYTES;
		const h = harness({ version: "0.4.0", build: 12, commit: "abc" });
		try {
			assert.equal((await h.updater.check()).status, "idle");
			feedBody = () => "{ not json";
			assert.equal((await h.updater.check()).status, "idle", "a silent check keeps idle");
			const manual = await h.updater.check({ manual: true });
			assert.equal(manual.status, "error");
			assert.equal(manual.retry, "check");
			assert.ok(h.logs.some((l) => l.startsWith("check failed")));
		} finally {
			h.cleanup();
		}
	});
});

describe("local updater: the swap helper", { skip: process.platform === "win32" ? "POSIX sh only" : false }, () => {
	it("waits for the pid, swaps the bundles, removes the backup and relaunches", () => {
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-swap-"));
		try {
			const target = path.join(temp, "T3Learn.app");
			const staged = path.join(temp, "staged", "T3Learn.app");
			for (const [dir, body] of [[target, "old"], [staged, "new"]] as const) {
				fs.mkdirSync(path.join(dir, "Contents"), { recursive: true });
				fs.writeFileSync(path.join(dir, "Contents", "Info.plist"), body);
			}
			const script = path.join(temp, "swap.sh");
			fs.writeFileSync(script, swapScript(), { mode: 0o755 });
			const logFile = path.join(temp, "update.log");
			// pid 999999999 never exists: the wait loop ends at once.
			const run = spawnSync("/bin/sh", [script, "999999999", staged, target, logFile, "true"], { encoding: "utf8", timeout: 20_000 });
			assert.equal(run.status, 0, run.stderr);
			assert.equal(fs.readFileSync(path.join(target, "Contents", "Info.plist"), "utf8"), "new");
			assert.equal(fs.existsSync(path.join(temp, "T3Learn.previous.app")), false, "the backup is removed on success");
			assert.equal(fs.existsSync(staged), false, "the staged bundle moved into place");
			assert.match(fs.readFileSync(logFile, "utf8"), /installed /);
		} finally {
			fs.rmSync(temp, { recursive: true, force: true });
		}
	});
});
