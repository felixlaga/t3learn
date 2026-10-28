/**
 * Publish the unsigned T3Learn build to the rolling `local-latest`
 * prerelease (owner, 2026-10-28). Run by .github/workflows/local-build.yml
 * after a green build; the installed app's updater
 * (electron/local-update.cjs) reads the manifest this writes.
 *
 *   node scripts/publish-local-build.mjs --dist dist/local --repo owner/name \
 *     --tag local-latest --build <run number> --commit <sha>
 *
 * Steps: find the one zip in --dist, hash it, write local-latest.json next
 * to it, point the tag at the commit, create the prerelease if missing,
 * drop zips from older versions, upload zip + manifest (clobbering), and
 * refresh the release notes. Needs `gh` with a token that can write
 * contents (the workflow's GITHUB_TOKEN).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_NAME = "local-latest.json";

/** The feed document. One asset per platform key (process.platform-process.arch). */
export function manifestFor({ version, build, commit, builtAt, notes, repo, tag, platformKey, zipName, size, sha512 }) {
	return {
		edition: "t3learn-local",
		version,
		build,
		commit,
		builtAt,
		notes,
		assets: {
			[platformKey]: {
				name: zipName,
				url: `https://github.com/${repo}/releases/download/${tag}/${zipName}`,
				size,
				sha512,
			},
		},
	};
}

export function sha512Of(file) {
	return createHash("sha512").update(fs.readFileSync(file)).digest("hex");
}

function defaultRun(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	if (result.error) return { status: 1, stdout: "", stderr: result.error.message };
	return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * @param options {{ dist: string, repo: string, tag: string, build: number, commit: string,
 *   platformKey?: string, run?: typeof defaultRun, log?: (line: string) => void, now?: () => Date,
 *   version?: string }}
 */
export async function publish(options) {
	const run = options.run ?? defaultRun;
	const log = options.log ?? ((line) => console.log(line));
	const platformKey = options.platformKey ?? "darwin-arm64";
	const { dist, repo, tag, commit } = options;
	const build = Number(options.build);
	if (!Number.isInteger(build) || build < 1) throw new Error(`--build must be a positive integer, got ${options.build}`);
	if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`--commit must be a full sha, got ${commit}`);
	if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`--repo must be owner/name, got ${repo}`);

	const zips = fs.readdirSync(dist).filter((name) => name.endsWith(".zip"));
	if (zips.length !== 1) throw new Error(`expected exactly one zip in ${dist}, found ${zips.length}: ${zips.join(", ")}`);
	const zipName = zips[0];
	const zipPath = path.join(dist, zipName);
	const size = fs.statSync(zipPath).size;
	const sha512 = sha512Of(zipPath);
	const version = options.version ?? JSON.parse(fs.readFileSync(path.resolve(dist, "..", "..", "package.json"), "utf8")).version;

	const subject = run("git", ["log", "-1", "--format=%s", commit]);
	const notes = subject.status === 0 ? subject.stdout.trim() : "";
	const builtAt = (options.now ?? (() => new Date()))().toISOString();
	const manifest = manifestFor({ version, build, commit, builtAt, notes, repo, tag, platformKey, zipName, size, sha512 });
	const manifestPath = path.join(dist, MANIFEST_NAME);
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	log(`manifest: ${zipName} (${size} bytes) build ${build} at ${commit.slice(0, 7)}`);

	// The tag follows main: force it onto this commit (create it the first time).
	const moved = run("gh", ["api", "-X", "PATCH", `repos/${repo}/git/refs/tags/${tag}`, "-f", `sha=${commit}`, "-F", "force=true"]);
	if (moved.status !== 0) {
		const created = run("gh", ["api", "-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${commit}`]);
		if (created.status !== 0) throw new Error(`could not point tag ${tag} at ${commit}: ${moved.stderr}${created.stderr}`);
		log(`tag ${tag} created at ${commit.slice(0, 7)}`);
	} else {
		log(`tag ${tag} moved to ${commit.slice(0, 7)}`);
	}

	const title = `T3Learn ${version} build ${build}`;
	const body = [
		`Unsigned Apple Silicon build of \`main\` at ${commit}.`,
		notes ? `Latest change: ${notes}` : "",
		"",
		"Installed copies update themselves from this release (sidebar → Update available).",
		"First install: unzip, move T3Learn.app to Applications, then run `xattr -dr com.apple.quarantine ~/Applications/T3Learn.app` once.",
	].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");

	const view = run("gh", ["release", "view", tag, "--repo", repo, "--json", "assets"]);
	if (view.status !== 0) {
		const created = run("gh", ["release", "create", tag, "--repo", repo, "--prerelease", "--title", title, "--notes", body]);
		if (created.status !== 0) throw new Error(`could not create release ${tag}: ${created.stderr}`);
		log(`release ${tag} created`);
	} else {
		const assets = JSON.parse(view.stdout || "{}").assets ?? [];
		for (const asset of assets) {
			if (asset.name.endsWith(".zip") && asset.name !== zipName) {
				const removed = run("gh", ["release", "delete-asset", tag, asset.name, "--repo", repo, "--yes"]);
				if (removed.status !== 0) throw new Error(`could not remove stale asset ${asset.name}: ${removed.stderr}`);
				log(`removed stale ${asset.name}`);
			}
		}
		const edited = run("gh", ["release", "edit", tag, "--repo", repo, "--prerelease", "--title", title, "--notes", body]);
		if (edited.status !== 0) throw new Error(`could not update release ${tag}: ${edited.stderr}`);
	}

	const uploaded = run("gh", ["release", "upload", tag, zipPath, manifestPath, "--repo", repo, "--clobber"]);
	if (uploaded.status !== 0) throw new Error(`upload failed: ${uploaded.stderr}`);
	log(`uploaded ${zipName} and ${MANIFEST_NAME} to ${tag}`);
	return manifest;
}

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		out[arg.slice(2)] = argv[i + 1];
		i += 1;
	}
	return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = parseArgs(process.argv.slice(2));
	for (const key of ["dist", "repo", "tag", "build", "commit"]) {
		if (!args[key]) {
			console.error(`missing --${key}`);
			process.exit(2);
		}
	}
	publish({ dist: args.dist, repo: args.repo, tag: args.tag, build: Number(args.build), commit: args.commit }).catch((err) => {
		console.error(err?.stack ?? err);
		process.exit(1);
	});
}
