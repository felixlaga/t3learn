/**
 * THE AUTOMATIC BACKUP's pure core (backup wave, owner 2026-10-28): what a
 * learning snapshot contains, how two snapshots differ, and the wire
 * shapes the Backup section reads. No IO — the fs side is
 * src/store/backup.ts, the GitHub side src/server/github.ts, and the
 * loop that ties them together src/server/backup.ts.
 *
 * The layout is the manual script's (scripts/learning-backup.mjs):
 * `snapshot/<path>` for every allowed record plus `snapshot/manifest.json`
 * ({schema: 1, createdAt, files: [{path, bytes, sha256}]}) — so
 * `npm run data:restore` reads an automatic backup unchanged. A test pins
 * that the two allowlists agree.
 */

export const BACKUP_SCHEMA = 1;
/** Records above this size are skipped and reported, never pushed in
 *  pieces (GitHub refuses files over 100 MiB; learning records this large
 *  are inline media that belong elsewhere). */
export const BACKUP_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** The repository the setup flow proposes. */
export const BACKUP_DEFAULT_REPO = "t3learn-data";

const GRAPH_FILES: ReadonlySet<string> = new Set([
	"nodes.jsonl",
	"chains.jsonl",
	"sessions.jsonl",
	"coverage.jsonl",
	"sources.json",
	"positions.json",
	"render-settings.json",
	"format.json",
]);

/** The explicit allowlist (mirrors scripts/learning-backup.mjs): the
 *  settings, learning and learner-tree records, every chat record, the known graph
 *  files. Never credentials, CLI state, jobs, logs, debug, caches,
 *  attachments or the backup's own bookkeeping. */
export function allowedLearningFile(relative: string): boolean {
	return (
		relative === "settings.json" ||
		relative === "learning.json" ||
		relative === "learner.json" ||
		/^chats\/[A-Za-z0-9_-]+\.json$/.test(relative) ||
		(relative.startsWith("graph/") && GRAPH_FILES.has(relative.slice(6)))
	);
}

/** A GitHub repository name the app will create or use: GitHub's own
 *  rule set (letters, digits, dot, dash, underscore; 100 max), no leading
 *  dot, no `.git` suffix. */
export function validBackupRepoName(name: string): boolean {
	return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(name) && !name.endsWith(".git") && name !== "." && name !== "..";
}

export interface SnapshotEntry {
	path: string;
	bytes: number;
	sha256: string;
}

export interface BackupManifest {
	schema: typeof BACKUP_SCHEMA;
	createdAt: string;
	files: SnapshotEntry[];
}

/** Which paths a push must write (new or changed content) and which it
 *  must delete (gone locally), against the last pushed inventory. `null`
 *  previous = nothing known pushed: everything is changed. */
export function snapshotDiff(previous: SnapshotEntry[] | null, next: SnapshotEntry[]): { changed: string[]; removed: string[]; unchanged: boolean } {
	const before = new Map((previous ?? []).map((f) => [f.path, f.sha256]));
	const after = new Map(next.map((f) => [f.path, f.sha256]));
	const changed = next.filter((f) => before.get(f.path) !== f.sha256).map((f) => f.path);
	const removed = [...before.keys()].filter((p) => !after.has(p));
	return { changed, removed, unchanged: previous !== null && changed.length === 0 && removed.length === 0 };
}

export function backupCommitMessage(changed: number, removed: number): string {
	const parts = [];
	if (changed > 0) parts.push(`${changed} record${changed === 1 ? "" : "s"} updated`);
	if (removed > 0) parts.push(`${removed} removed`);
	return `Back up learning records${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

/** The README the app writes into a fresh repository. */
export const BACKUP_README = [
	"# Private T3Learn learning backup",
	"",
	"Keep this repository private. `snapshot/` holds your learning records and a checksum manifest. The T3Learn app updates it on its own after each change.",
	"",
	"Credentials, logs, jobs, CLI state and attachment files are never included.",
	"",
	"Restore: https://github.com/felixlaga/t3learn/blob/main/docs/learning-data.md",
	"",
	"The latest commit reflects deletions; earlier commits keep older records. This is versioned backup storage, not live multi-device sync.",
	"",
].join("\n");

/** The settings record's backup section (settings.json `backup`): the
 *  user's explicit choices only. `enabled` off keeps the token and the
 *  repository but pushes nothing. */
export interface BackupSettings {
	enabled?: boolean;
	repo?: string;
}

/** What GET /api/backup answers — the Backup section and the setup
 *  dialog's last stage render from this alone. */
export interface BackupStatus {
	/** The app was built with a GitHub OAuth client id: the device-code
	 *  sign-in is offered. Otherwise only a pasted token works. */
	clientId: boolean;
	/** A token is stored. */
	connected: boolean;
	/** The GitHub account the token belongs to (known after sign-in or the
	 *  first use of a pasted token). */
	login: string | null;
	repo: string | null;
	repoUrl: string | null;
	enabled: boolean;
	lastPushAt: string | null;
	lastCommit: string | null;
	lastError: string | null;
	/** A push is scheduled (changes waiting for the debounce). */
	pending: boolean;
	pushing: boolean;
	/** Records in the last pushed snapshot. */
	files: number;
	/** Records left out of the last push (too large). */
	skipped: string[];
	/** A device-code sign-in in progress: show the code and the link. */
	device: { userCode: string; verificationUri: string; expiresAt: string } | null;
}

export const EMPTY_BACKUP_STATUS: BackupStatus = {
	clientId: false,
	connected: false,
	login: null,
	repo: null,
	repoUrl: null,
	enabled: false,
	lastPushAt: null,
	lastCommit: null,
	lastError: null,
	pending: false,
	pushing: false,
	files: 0,
	skipped: [],
	device: null,
};
