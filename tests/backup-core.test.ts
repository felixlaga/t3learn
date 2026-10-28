/**
 * The automatic backup's pure core (backup wave, 2026-10-28): the
 * allowlist agrees with the manual script's (so `npm run data:restore`
 * reads an automatic backup), the diff names exactly what a push must
 * write and delete, and the repository-name rule matches GitHub's.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedLearningFile as scriptAllowed } from "../scripts/learning-backup.mjs";
import { allowedLearningFile, backupCommitMessage, snapshotDiff, validBackupRepoName } from "../src/core/backup.ts";
import { sanitizeUserSettings } from "../src/core/settings.ts";

describe("backup core", () => {
	it("the allowlist is the manual script's, record for record", () => {
		const samples = [
			"settings.json", "learning.json", "chats/chat_1.json", "chats/x.txt", "graph/nodes.jsonl", "graph/chains.jsonl", "graph/sessions.jsonl", "graph/coverage.jsonl",
			"graph/sources.json", "graph/positions.json", "graph/render-settings.json", "graph/format.json", "graph/private.json", "auth.json", "cli-providers.json",
			"backup-state.json", "jobs/j.json", "debug/trace.json", "attachments/a.json", "../auth.json", "chats/../auth.json", "chats\\chat_1.json",
		];
		for (const sample of samples) assert.equal(allowedLearningFile(sample), scriptAllowed(sample), sample);
		assert.equal(allowedLearningFile("backup-state.json"), false, "the bookkeeping never backs itself up");
	});

	it("the diff: changed = new or different sha, removed = gone; null previous = everything changed", () => {
		const before = [{ path: "a", bytes: 1, sha256: "1" }, { path: "b", bytes: 1, sha256: "2" }, { path: "c", bytes: 1, sha256: "3" }];
		const after = [{ path: "a", bytes: 1, sha256: "1" }, { path: "b", bytes: 2, sha256: "9" }, { path: "d", bytes: 1, sha256: "4" }];
		assert.deepEqual(snapshotDiff(before, after), { changed: ["b", "d"], removed: ["c"], unchanged: false });
		assert.deepEqual(snapshotDiff(before, before), { changed: [], removed: [], unchanged: true });
		assert.deepEqual(snapshotDiff(null, after), { changed: ["a", "b", "d"], removed: [], unchanged: false });
		assert.equal(snapshotDiff(null, []).unchanged, false, "nothing known pushed is never 'unchanged'");
	});

	it("repository names follow GitHub's rule", () => {
		for (const ok of ["t3learn-data", "My_Notes.2026", "a"]) assert.ok(validBackupRepoName(ok), ok);
		for (const bad of ["", ".dot", "has space", "x".repeat(101), "name.git", "a/b", "..", "ü"]) assert.ok(!validBackupRepoName(bad), bad);
	});

	it("commit messages count what moved", () => {
		assert.equal(backupCommitMessage(0, 0), "Back up learning records");
		assert.equal(backupCommitMessage(1, 0), "Back up learning records (1 record updated)");
		assert.equal(backupCommitMessage(3, 2), "Back up learning records (3 records updated, 2 removed)");
	});

	it("the settings record keeps a sound backup section and drops a bad repo name", () => {
		const out = sanitizeUserSettings({ backup: { enabled: true, repo: "t3learn-data", junk: 1 } });
		assert.deepEqual(out?.backup, { enabled: true, repo: "t3learn-data" });
		assert.deepEqual(sanitizeUserSettings({ backup: { enabled: "yes", repo: "bad name" } })?.backup, {});
	});
});
