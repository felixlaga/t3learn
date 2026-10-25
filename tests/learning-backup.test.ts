import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { allowedLearningFile, collectLearningSnapshot, restoreLearningSnapshot } from "../scripts/learning-backup.mjs";

function fixture(t: { after(fn: () => void): void }) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-backup-test-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const write = (relative: string, value: string) => { const full = path.join(root, relative); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, value); };
	return { root, write };
}
test("backup allowlist excludes credential stores, runtime state, jobs, logs, and attachments", (t) => {
	const { root, write } = fixture(t);
	for (const file of ["chats/chat_1.json", "graph/nodes.jsonl", "settings.json", "auth.json", "cli-providers.json", "graph/auth.json", "jobs/task.json", "debug/trace.json", "attachments/file.json"]) write(file, '{}\n');
	assert.deepEqual(collectLearningSnapshot(root).map((file: { path: string }) => file.path), ["chats/chat_1.json", "graph/nodes.jsonl", "settings.json"]);
	for (const file of ["../auth.json", "graph/../../auth.json", "chats/../auth.json", "graph/nodes.jsonl/secret", "chats\\chat_1.json"]) assert.equal(allowedLearningFile(file), false);
});
test("backup refuses symlinks, broken JSON and large inline records", (t) => {
	const { root, write } = fixture(t);
	write("auth.json", '{"secret":"fixture"}'); fs.mkdirSync(path.join(root, "chats")); fs.symlinkSync(path.join(root, "auth.json"), path.join(root, "chats/chat_1.json"));
	assert.throws(() => collectLearningSnapshot(root), /linked/);
	fs.unlinkSync(path.join(root, "chats/chat_1.json")); write("chats/chat_1.json", '{"incomplete":');
	assert.throws(() => collectLearningSnapshot(root), /invalid JSON/);
	write("chats/chat_1.json", '"' + "x".repeat(10 * 1024 * 1024) + '"');
	assert.throws(() => collectLearningSnapshot(root), /10 MiB/);
});
test("restore verifies checksums before writing and never overwrites an existing destination", (t) => {
	const { root, write } = fixture(t);
	const content = '{"lesson":"fixture"}\n';
	write("snapshot/chats/chat_1.json", content);
	write("snapshot/manifest.json", JSON.stringify({ schema: 1, files: [{ path: "chats/chat_1.json", bytes: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") }] }));
	const destination = path.join(root, "restored");
	assert.equal(restoreLearningSnapshot(path.join(root, "snapshot"), destination), 1);
	assert.equal(fs.readFileSync(path.join(destination, "chats/chat_1.json"), "utf8"), content);
	assert.throws(() => restoreLearningSnapshot(path.join(root, "snapshot"), destination), /already exists/);
	write("snapshot/chats/chat_1.json", '{"tampered":true}');
	assert.throws(() => restoreLearningSnapshot(path.join(root, "snapshot"), path.join(root, "bad")), /checksum/);
	assert.equal(fs.existsSync(path.join(root, "bad")), false);
});
test("restore rejects path traversal and secret paths even with a manifest", (t) => {
	const { root, write } = fixture(t);
	for (const file of ["../../auth.json", "auth.json", "graph/private.json"]) {
		write("snapshot/manifest.json", JSON.stringify({ schema: 1, files: [{ path: file, bytes: 0, sha256: "" }] }));
		assert.throws(() => restoreLearningSnapshot(path.join(root, "snapshot"), path.join(root, "bad")), /Unsafe/);
		assert.equal(fs.existsSync(path.join(root, "bad")), false);
	}
});
test("backup refuses a public destination before cloning or uploading", (t) => {
	const { root, write } = fixture(t);
	write("data/chats/chat_1.json", '{}');
	write("bin/gh", '#!/usr/bin/env node\nif(process.argv[2]!=="api")process.exit(42);console.log(JSON.stringify({private:false,full_name:"fixture/data"}));\n');
	fs.chmodSync(path.join(root, "bin/gh"), 0o755);
	const result = spawnSync(process.execPath, ["scripts/learning-backup.mjs", "backup", "--repo", "fixture/data", "--data", path.join(root, "data")], { env: { ...process.env, PATH: path.join(root, "bin") + path.delimiter + process.env.PATH }, encoding: "utf8" });
	assert.equal(result.status, 1); assert.match(result.stderr, /PRIVATE repository/);
});
