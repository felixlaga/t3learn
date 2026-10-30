import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GRAPH_FILES = new Set(["nodes.jsonl", "chains.jsonl", "sessions.jsonl", "coverage.jsonl", "sources.json", "positions.json", "render-settings.json", "format.json"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
export function allowedLearningFile(relative) {
	return relative === "settings.json" || relative === "learning.json" || relative === "learner.json" || /^chats\/[A-Za-z0-9_-]+\.json$/.test(relative) || relative.startsWith("graph/") && GRAPH_FILES.has(relative.slice(6));
}
const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Explicit allowlist: never copy auth, CLI credentials/config, caches, jobs,
 * debug logs, binaries, or attachment directories. Reject links and oversized
 * records rather than silently creating an incomplete backup. */
export function collectLearningSnapshot(dataDir) {
	const root = path.resolve(dataDir);
	if (!fs.statSync(root).isDirectory()) throw new Error("Learning data directory is not a directory.");
	const candidates = ["settings.json", "learning.json", "learner.json"];
	for (const directory of ["chats", "graph"]) {
		const full = path.join(root, directory);
		if (!fs.existsSync(full)) continue;
		if (fs.lstatSync(full).isSymbolicLink() || !fs.statSync(full).isDirectory()) throw new Error(`Refusing linked or invalid ${directory} directory.`);
		for (const name of fs.readdirSync(full)) candidates.push(`${directory}/${name}`);
	}
	const files = [];
	for (const relative of candidates.filter(allowedLearningFile).sort()) {
		const full = path.join(root, relative);
		if (!fs.existsSync(full)) continue;
		const stat = fs.lstatSync(full);
		if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing linked or invalid record: ${relative}`);
		if (stat.size > MAX_FILE_BYTES) throw new Error(`Record exceeds the 10 MiB backup limit: ${relative}. No backup was pushed. Large attachments need separate storage.`);
		const content = fs.readFileSync(full);
		try {
			if (relative.endsWith(".jsonl")) { for (const line of content.toString("utf8").split("\n").filter((l) => l.trim())) JSON.parse(line); }
			else JSON.parse(content.toString("utf8"));
		} catch { throw new Error(`Record is incomplete or invalid JSON: ${relative}. Quit the app and retry.`); }
		files.push({ path: relative, bytes: content.length, sha256: digest(content), content });
	}
	return files;
}
const inventory = (files) => files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
const signature = (files) => JSON.stringify(inventory(files));

export function restoreLearningSnapshot(snapshotDir, destination) {
	if (fs.existsSync(destination)) throw new Error("Restore destination already exists. Choose a new directory; existing data is never overwritten.");
	const manifestPath = path.join(snapshotDir, "manifest.json");
	if (fs.lstatSync(manifestPath).isSymbolicLink()) throw new Error("Invalid linked backup manifest.");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	if (manifest.schema !== 1 || !Array.isArray(manifest.files)) throw new Error("Unsupported backup manifest.");
	const verified = [], seen = new Set();
	for (const file of manifest.files) {
		if (typeof file.path !== "string" || !allowedLearningFile(file.path) || seen.has(file.path)) throw new Error("Unsafe or duplicate path in backup manifest.");
		seen.add(file.path);
		const full = path.join(snapshotDir, file.path);
		if (fs.lstatSync(full).isSymbolicLink() || fs.lstatSync(path.dirname(full)).isSymbolicLink()) throw new Error("Refusing linked backup record.");
		const content = fs.readFileSync(full);
		if (content.length > MAX_FILE_BYTES || content.length !== file.bytes || digest(content) !== file.sha256) throw new Error(`Backup checksum failed: ${file.path}`);
		verified.push({ path: file.path, content });
	}
	fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
	for (const file of verified) {
		const full = path.join(destination, file.path);
		fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 });
		fs.writeFileSync(full, file.content, { mode: 0o600, flag: "wx" });
	}
	return verified.length;
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
	if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed. Check your GitHub login, repository access, and network connection.`);
	return result.stdout.trim();
}
function requirePrivate(repo) {
	const metadata = JSON.parse(run("gh", ["api", `repos/${repo}`]));
	if (metadata.private !== true || metadata.full_name.toLowerCase() !== repo.toLowerCase()) throw new Error("Learning backups require the exact PRIVATE repository you selected. Nothing was uploaded.");
}
function argument(args, name) {
	const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1];
}
export function main(args = process.argv.slice(2)) {
	const mode = args[0], repo = argument(args, "--repo");
	if (!["backup", "restore"].includes(mode) || !repo || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Usage: npm run data:backup -- --repo OWNER/PRIVATE_REPO [--data PATH]\n       npm run data:restore -- --repo OWNER/PRIVATE_REPO --output NEW_DIRECTORY");
	let files, dataDir;
	if (mode === "backup") {
		dataDir = argument(args, "--data") ?? process.env.LH_DATA_DIR ?? (process.platform === "darwin" ? path.join(os.homedir(), "Library/Application Support/LearnHarness Local/data") : undefined);
		if (!dataDir) throw new Error("Specify your app's data directory with --data.");
		files = collectLearningSnapshot(dataDir);
	}
	const destination = argument(args, "--output");
	if (mode === "restore" && (!destination || fs.existsSync(path.resolve(destination)))) throw new Error("Restore requires --output pointing to a new, nonexistent directory.");
	requirePrivate(repo);
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "t3learn-backup-"));
	const checkout = path.join(temp, "checkout");
	try {
		run("gh", ["repo", "clone", repo, checkout, "--", "--depth", "1"]);
		const snapshot = path.join(checkout, "snapshot");
		if (fs.existsSync(snapshot) && fs.lstatSync(snapshot).isSymbolicLink()) throw new Error("Refusing linked snapshot directory.");
		if (mode === "restore") {
			const count = restoreLearningSnapshot(snapshot, path.resolve(destination));
			console.log(`Verified and restored ${count} learning records to ${path.resolve(destination)}. Credentials and external files are not included.`);
			return;
		}
		// Detect writes/deletions during collection. Quit the app for a consistent snapshot.
		if (signature(files) !== signature(collectLearningSnapshot(dataDir))) throw new Error("Learning records changed during backup. Quit the app and retry.");
		const manifestFile = path.join(snapshot, "manifest.json");
		if (fs.existsSync(manifestFile)) {
			if (fs.lstatSync(manifestFile).isSymbolicLink()) throw new Error("Refusing linked manifest.");
			const previous = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
			if (JSON.stringify(previous.files) === signature(files)) { console.log("Learning backup is already up to date."); return; }
		}
		fs.rmSync(snapshot, { recursive: true, force: true });
		fs.mkdirSync(snapshot, { recursive: true, mode: 0o700 });
		for (const file of files) {
			const full = path.join(snapshot, file.path); fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 });
			fs.writeFileSync(full, file.content, { mode: 0o600 });
		}
		fs.writeFileSync(manifestFile, JSON.stringify({ schema: 1, createdAt: new Date().toISOString(), files: inventory(files) }, null, 2) + "\n", { mode: 0o600 });
		if (!fs.existsSync(path.join(checkout, "README.md"))) fs.writeFileSync(path.join(checkout, "README.md"), "# Private T3Learn learning backup\n\nKeep this repository private. `snapshot/` contains learning records and a checksum manifest. Credentials, logs, jobs, CLI state and external attachments are excluded.\n\nBackup/restore instructions: https://github.com/felixlaga/t3learn/blob/main/docs/learning-data.md\n\nThe latest snapshot reflects deletions; earlier commits retain older records. GitHub is versioned backup storage, not live multi-device sync.\n");
		run("git", ["add", "--", "snapshot", "README.md"], checkout);
		run("git", ["-c", "user.name=T3Learn Backup", "-c", "user.email=backup@users.noreply.github.com", "commit", "-m", "Back up learning records"], checkout);
		requirePrivate(repo); // Recheck immediately before the upload.
		run("git", ["push", "origin", "HEAD:main"], checkout);
		console.log(`Backed up ${files.length} records (${files.reduce((sum, file) => sum + file.bytes, 0)} bytes) to private https://github.com/${repo}.`);
	} finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "Backup failed."); process.exitCode = 1; }
}
