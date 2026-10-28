/**
 * The automatic backup's fs side (backup wave, owner 2026-10-28): collect
 * the learning snapshot from the data directory, and keep the push
 * bookkeeping (config.BACKUP_STATE_FILE). The allowlist and the diff are
 * core/backup.ts; the GitHub calls are the server's.
 *
 * Collection is the manual script's discipline (scripts/learning-backup.mjs)
 * with one difference fit for a loop nobody watches: a record over the
 * size limit is SKIPPED and reported instead of stopping the whole backup
 * forever. Torn JSON (a write in flight) still throws — the loop retries
 * later, the manual script asks you to quit the app.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { BACKUP_STATE_FILE, PATHS } from "../../config.ts";
import { BACKUP_MAX_FILE_BYTES, allowedLearningFile, type SnapshotEntry } from "../core/backup.ts";

export interface CollectedFile extends SnapshotEntry {
	content: Buffer;
}

export interface CollectedSnapshot {
	files: CollectedFile[];
	/** Records left out, with the reason (shown in the Backup section). */
	skipped: { path: string; reason: string }[];
}

const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

/** Every allowed record under the data dir, sorted by path, with content
 *  and checksum. Links are refused outright (a planted link could pull a
 *  credential file into the snapshot). */
export function collectSnapshot(dataDir: string = PATHS.data): CollectedSnapshot {
	const root = path.resolve(dataDir);
	if (!fs.existsSync(root)) return { files: [], skipped: [] };
	if (!fs.statSync(root).isDirectory()) throw new Error("Learning data directory is not a directory.");
	const candidates = ["settings.json", "learning.json"];
	for (const directory of ["chats", "graph"]) {
		const full = path.join(root, directory);
		if (!fs.existsSync(full)) continue;
		if (fs.lstatSync(full).isSymbolicLink() || !fs.statSync(full).isDirectory()) throw new Error(`Refusing linked or invalid ${directory} directory.`);
		for (const name of fs.readdirSync(full)) candidates.push(`${directory}/${name}`);
	}
	const files: CollectedFile[] = [];
	const skipped: { path: string; reason: string }[] = [];
	for (const relative of candidates.filter(allowedLearningFile).sort()) {
		const full = path.join(root, relative);
		if (!fs.existsSync(full)) continue;
		const stat = fs.lstatSync(full);
		if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing linked or invalid record: ${relative}`);
		if (stat.size > BACKUP_MAX_FILE_BYTES) {
			skipped.push({ path: relative, reason: `over ${Math.round(BACKUP_MAX_FILE_BYTES / 1024 / 1024)} MiB` });
			continue;
		}
		const content = fs.readFileSync(full);
		try {
			if (relative.endsWith(".jsonl")) {
				for (const line of content.toString("utf8").split("\n").filter((l) => l.trim())) JSON.parse(line);
			} else {
				JSON.parse(content.toString("utf8"));
			}
		} catch {
			throw new Error(`Record is incomplete or invalid JSON: ${relative}`);
		}
		files.push({ path: relative, bytes: content.length, sha256: digest(content), content });
	}
	return { files, skipped };
}

/** What was last pushed. `files` is the inventory the diff runs against;
 *  `lastCommit` is the commit the next push builds on (a different remote
 *  head means someone else wrote the repository: the next push rebuilds
 *  the whole tree instead of patching). */
export interface BackupState {
	version: 1;
	login: string | null;
	repo: string | null;
	lastPushAt: string | null;
	lastCommit: string | null;
	lastError: string | null;
	files: SnapshotEntry[];
	skipped: string[];
}

export const EMPTY_BACKUP_STATE: BackupState = {
	version: 1,
	login: null,
	repo: null,
	lastPushAt: null,
	lastCommit: null,
	lastError: null,
	files: [],
	skipped: [],
};

const isEntry = (v: unknown): v is SnapshotEntry =>
	typeof v === "object" && v !== null && typeof (v as SnapshotEntry).path === "string" && typeof (v as SnapshotEntry).bytes === "number" && typeof (v as SnapshotEntry).sha256 === "string";

/** Absent or corrupt = nothing pushed yet (the next push rebuilds). */
export function readBackupState(file: string = BACKUP_STATE_FILE): BackupState {
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<BackupState>;
		if (!raw || typeof raw !== "object" || raw.version !== 1) return { ...EMPTY_BACKUP_STATE };
		const str = (v: unknown) => (typeof v === "string" ? v : null);
		return {
			version: 1,
			login: str(raw.login),
			repo: str(raw.repo),
			lastPushAt: str(raw.lastPushAt),
			lastCommit: str(raw.lastCommit),
			lastError: str(raw.lastError),
			files: Array.isArray(raw.files) ? raw.files.filter(isEntry) : [],
			skipped: Array.isArray(raw.skipped) ? raw.skipped.filter((s): s is string => typeof s === "string") : [],
		};
	} catch {
		return { ...EMPTY_BACKUP_STATE };
	}
}

/** Atomic write (tmp + rename), 0600 like the other records. */
export function writeBackupState(state: BackupState, file: string = BACKUP_STATE_FILE): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(state, null, "\t")}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
}
