/**
 * THE AUTOMATIC BACKUP (backup wave, owner 2026-10-28): the app keeps a
 * private GitHub repository equal to the learner's records, by itself.
 *
 * One loop, three inputs: the settings record's `backup` section (on/off
 * + repository name), the token in auth.json (GITHUB_BACKUP_TOKEN — put
 * there by the device-code sign-in below, or pasted), and the push
 * bookkeeping (store/backup.ts). Writes announce themselves on the event
 * bus (turn-settled, chats-changed, record-changed, activity-changed,
 * compaction-changed); each announcement arms a 30s debounce, and a
 * 5-minute tick catches the writers that announce nothing (learning.json,
 * settings). A push that finds nothing changed costs one GET.
 *
 * A push is one commit through the Git Data API: blobs for the changed
 * records, a tree on the last pushed commit's tree (deletions as sha
 * null), a commit, a fast-forward of the branch. If the branch head is
 * not the commit this app last pushed (another device, a hand edit, a
 * fresh install), the whole snapshot tree is rebuilt instead of patched:
 * the local records are the truth of `snapshot/`. One guard protects the
 * fresh-install case: a repository with history is never overwritten by
 * an app that has no records yet.
 *
 * Failures are reported (Settings → Backup) and retried after 5 minutes.
 * The repository must be private; a public one is refused before any
 * byte leaves. Nothing is ever force-pushed.
 *
 * Built behind a factory so the tests drive it against a loopback GitHub;
 * backupSync() is the process singleton on real dependencies.
 */

import { GITHUB_OAUTH_CLIENT_ID } from "../../config.ts";
import { BACKUP_README, BACKUP_SCHEMA, backupCommitMessage, snapshotDiff, validBackupRepoName, type BackupManifest, type BackupSettings, type BackupStatus, type SnapshotEntry } from "../core/backup.ts";
import { emit, subscribe, type ServerEvent } from "../core/events.ts";
import { CURRENT_SETTINGS_VERSION } from "../core/settings.ts";
import { collectSnapshot, readBackupState, writeBackupState, type BackupState, type CollectedSnapshot } from "../store/backup.ts";
import { settingsStore } from "../store/settings.ts";
import { createGitHubClient, GitHubError, pollDeviceFlow, startDeviceFlow, type TreeEntry } from "./github.ts";
import { deleteKey, keyValue, saveKey } from "./keys.ts";

export const BACKUP_TOKEN_KEY = "GITHUB_BACKUP_TOKEN";

/** The bus events after which records may have changed. */
const PUSH_TRIGGERS: ReadonlySet<ServerEvent["type"]> = new Set(["turn-settled", "chats-changed", "record-changed", "activity-changed", "compaction-changed", "learner-changed"]);

export interface BackupSyncDeps {
	clientId: string;
	readSettings(): BackupSettings;
	writeSettings(next: BackupSettings): void;
	token(): string | undefined;
	saveToken(token: string): void;
	deleteToken(): void;
	readState(): BackupState;
	writeState(state: BackupState): void;
	collect(): CollectedSnapshot;
	fetch?: typeof fetch;
	apiBase?: string;
	webBase?: string;
	/** Quiet time after the last write before a push (default 30s). */
	debounceMs?: number;
	/** Wait after a failed push (default 5 min). */
	retryMs?: number;
	/** The catch-all tick for silent writers (default 5 min). */
	tickMs?: number;
	/** First push after start (default 15s). */
	startDelayMs?: number;
	now?: () => Date;
	log?: (line: string) => void;
	/** Announce a state change (the real one emits backup-changed). */
	onChange?: () => void;
	/** The event bus to listen on (the real one is core/events subscribe). */
	subscribe?: (listener: (event: ServerEvent) => void) => () => void;
}

export class BackupInputError extends Error {}

export function createBackupSync(deps: BackupSyncDeps) {
	const debounceMs = deps.debounceMs ?? 30_000;
	const retryMs = deps.retryMs ?? 5 * 60_000;
	const tickMs = deps.tickMs ?? 5 * 60_000;
	const startDelayMs = deps.startDelayMs ?? 15_000;
	const now = deps.now ?? (() => new Date());
	const log = deps.log ?? ((line: string) => console.info(`[backup] ${line}`));
	const change = () => deps.onChange?.();
	const github = (token: string) => createGitHubClient({ token, fetch: deps.fetch, apiBase: deps.apiBase });
	const flow = { clientId: deps.clientId, fetch: deps.fetch, webBase: deps.webBase };

	let pendingTimer: ReturnType<typeof setTimeout> | null = null;
	let tickTimer: ReturnType<typeof setInterval> | null = null;
	let unsubscribe: (() => void) | null = null;
	let inFlight: Promise<BackupStatus> | null = null;
	let again = false;
	let pushing = false;
	let loginError: string | null = null;
	let device: { deviceCode: string; userCode: string; verificationUri: string; expiresAt: number; interval: number; timer: ReturnType<typeof setTimeout> | null } | null = null;

	function status(): BackupStatus {
		const settings = deps.readSettings();
		const state = deps.readState();
		const login = state.login;
		const repo = settings.repo ?? null;
		return {
			clientId: deps.clientId !== "",
			connected: deps.token() !== undefined,
			login,
			repo,
			repoUrl: login && repo ? `https://github.com/${login}/${repo}` : null,
			enabled: settings.enabled === true,
			lastPushAt: state.lastPushAt,
			lastCommit: state.lastCommit,
			lastError: loginError ?? state.lastError,
			pending: pendingTimer !== null,
			pushing,
			files: state.files.length,
			skipped: state.skipped,
			device: device ? { userCode: device.userCode, verificationUri: device.verificationUri, expiresAt: new Date(device.expiresAt).toISOString() } : null,
		};
	}

	function configured(): boolean {
		const settings = deps.readSettings();
		return settings.enabled === true && !!settings.repo && deps.token() !== undefined;
	}

	function clearPending() {
		if (pendingTimer) clearTimeout(pendingTimer);
		pendingTimer = null;
	}

	/** Arm (or re-arm) the debounce. Cheap: no settings read until it fires. */
	function requestPush(delayMs: number = debounceMs): void {
		clearPending();
		pendingTimer = setTimeout(() => {
			pendingTimer = null;
			void pushNow();
		}, delayMs);
		pendingTimer.unref?.();
	}

	// ── the push ────────────────────────────────────────────────────────────

	async function commitSnapshot(
		client: ReturnType<typeof github>,
		login: string,
		repo: string,
		branch: string,
		head: string | null,
		baseTree: string | null,
		collected: CollectedSnapshot,
		inventory: SnapshotEntry[],
		diff: ReturnType<typeof snapshotDiff>,
	): Promise<string> {
		const incremental = baseTree !== null;
		const entries: TreeEntry[] = [];
		const changed = new Set(diff.changed);
		for (const file of collected.files) {
			if (incremental && !changed.has(file.path)) continue;
			entries.push({ path: `snapshot/${file.path}`, mode: "100644", type: "blob", sha: await client.createBlob(login, repo, file.content) });
		}
		if (incremental) {
			for (const removed of diff.removed) entries.push({ path: `snapshot/${removed}`, mode: "100644", type: "blob", sha: null });
		}
		const manifest: BackupManifest = { schema: BACKUP_SCHEMA, createdAt: now().toISOString(), files: inventory };
		entries.push({ path: "snapshot/manifest.json", mode: "100644", type: "blob", sha: await client.createBlob(login, repo, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)) });
		if (!incremental) entries.push({ path: "README.md", mode: "100644", type: "blob", sha: await client.createBlob(login, repo, Buffer.from(BACKUP_README)) });
		const tree = await client.createTree(login, repo, entries, incremental ? baseTree : undefined);
		const commit = await client.createCommit(login, repo, { message: backupCommitMessage(diff.changed.length, diff.removed.length), tree, parents: head ? [head] : [] });
		await client.setHead(login, repo, branch, commit, head === null);
		return commit;
	}

	async function run(retried = false): Promise<BackupStatus> {
		clearPending();
		const settings = deps.readSettings();
		const token = deps.token();
		if (settings.enabled !== true || !settings.repo || !token) return status();
		pushing = true;
		change();
		let state = deps.readState();
		try {
			const client = github(token);
			const login = state.login ?? (await client.me()).login;
			const repoName = settings.repo;
			const repo = await client.getRepo(login, repoName);
			if (!repo) throw new Error(`Repository ${login}/${repoName} does not exist. Connect it again in Settings → Backup.`);
			if (!repo.private) throw new Error(`Repository ${repo.fullName} is not private. Nothing was pushed.`);
			const collected = deps.collect();
			const inventory: SnapshotEntry[] = collected.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
			const head = await client.getHead(login, repoName, repo.defaultBranch);
			const incremental = head !== null && head === state.lastCommit;
			const diff = snapshotDiff(incremental ? state.files : null, inventory);
			const skipped = collected.skipped.map((s) => s.path);
			if (incremental && diff.unchanged) {
				state = { ...state, login, repo: repoName, lastError: null, skipped };
				deps.writeState(state);
				return status();
			}
			if (!incremental && head !== null && inventory.length === 0) {
				throw new Error(`${repo.fullName} already holds a backup and this app has no records yet. Restore it first (docs/learning-data.md) or choose a new repository name.`);
			}
			const baseTree = incremental ? await client.getCommitTree(login, repoName, head) : null;
			const commit = await commitSnapshot(client, login, repoName, repo.defaultBranch, head, baseTree, collected, inventory, diff);
			state = { ...state, login, repo: repoName, lastPushAt: now().toISOString(), lastCommit: commit, lastError: null, files: inventory, skipped };
			deps.writeState(state);
			log(`pushed ${commit.slice(0, 7)} to ${repo.fullName}: ${diff.changed.length} changed, ${diff.removed.length} removed${skipped.length ? `, ${skipped.length} skipped` : ""}`);
			return status();
		} catch (err) {
			// Someone moved the branch between our read and our write: one
			// immediate retry rebuilds on the new head.
			if (!retried && err instanceof GitHubError && (err.status === 422 || err.status === 409)) {
				log(`branch moved under the push (${err.status}); retrying once`);
				pushing = false;
				return run(true);
			}
			const message = err instanceof Error ? err.message : String(err);
			deps.writeState({ ...state, lastError: message });
			log(`push failed: ${message}`);
			requestPush(retryMs);
			return status();
		} finally {
			pushing = false;
			change();
		}
	}

	/** Push now; a push already running is awaited and a second request
	 *  during it queues one more run. */
	function pushNow(): Promise<BackupStatus> {
		if (inFlight) {
			again = true;
			return inFlight;
		}
		inFlight = run().finally(() => {
			inFlight = null;
			if (again) {
				again = false;
				requestPush(0);
			}
		});
		return inFlight;
	}

	// ── sign-in (device flow) ──────────────────────────────────────────────

	function schedulePoll(seconds: number) {
		if (!device) return;
		if (device.timer) clearTimeout(device.timer);
		device.timer = setTimeout(() => void poll(), seconds * 1000);
		device.timer.unref?.();
	}

	async function poll() {
		const current = device;
		if (!current) return;
		if (now().getTime() > current.expiresAt) {
			loginError = "The sign-in code expired. Start again.";
			device = null;
			change();
			return;
		}
		try {
			const result = await pollDeviceFlow(flow, current.deviceCode);
			if (device !== current) return; // a newer sign-in or a disconnect replaced this one
			switch (result.kind) {
				case "token": {
					deps.saveToken(result.token);
					device = null;
					const { login } = await github(result.token).me();
					deps.writeState({ ...deps.readState(), login, lastError: null });
					loginError = null;
					log(`signed in as ${login}`);
					change();
					if (configured()) requestPush(0);
					return;
				}
				case "pending":
					schedulePoll(current.interval);
					return;
				case "slow_down":
					current.interval = result.interval;
					schedulePoll(result.interval);
					return;
				case "failed":
					loginError = result.reason;
					device = null;
					change();
					return;
			}
		} catch (err) {
			// A network blip mid-flow: keep polling until the code expires.
			log(`device poll failed: ${err instanceof Error ? err.message : String(err)}`);
			if (device === current) schedulePoll(current.interval);
		}
	}

	async function startDeviceLogin(): Promise<BackupStatus> {
		if (!deps.clientId) throw new BackupInputError("This build has no GitHub client id, so the code sign-in is unavailable. Paste a token instead.");
		if (device?.timer) clearTimeout(device.timer);
		loginError = null;
		const code = await startDeviceFlow(flow);
		device = { deviceCode: code.deviceCode, userCode: code.userCode, verificationUri: code.verificationUri, expiresAt: now().getTime() + code.expiresIn * 1000, interval: code.interval, timer: null };
		schedulePoll(code.interval);
		change();
		return status();
	}

	// ── the repository ────────────────────────────────────────────────────

	async function connectRepo(name: string): Promise<BackupStatus> {
		if (!validBackupRepoName(name)) throw new BackupInputError("Choose a repository name of letters, digits, dots, dashes or underscores.");
		const token = deps.token();
		if (!token) throw new BackupInputError("Sign in to GitHub first.");
		const client = github(token);
		const { login } = await client.me();
		let repo = await client.getRepo(login, name);
		if (repo && !repo.private) throw new BackupInputError(`${repo.fullName} exists and is public. Learning records only go to a private repository; choose another name.`);
		if (!repo) {
			repo = await client.createRepo(name);
			log(`created private repository ${repo.fullName}`);
		}
		deps.writeSettings({ enabled: true, repo: name });
		deps.writeState({ ...deps.readState(), login, repo: name, lastCommit: null, files: [], lastError: null });
		loginError = null;
		change();
		requestPush(0);
		return status();
	}

	function disconnect(): BackupStatus {
		if (device?.timer) clearTimeout(device.timer);
		device = null;
		loginError = null;
		clearPending();
		deps.deleteToken();
		const settings = deps.readSettings();
		deps.writeSettings({ ...(settings.repo ? { repo: settings.repo } : {}), enabled: false });
		deps.writeState({ ...deps.readState(), login: null, lastError: null });
		change();
		return status();
	}

	// ── the loop ──────────────────────────────────────────────────────────

	function start(): void {
		if (unsubscribe) return;
		unsubscribe = deps.subscribe?.((event) => {
			if (PUSH_TRIGGERS.has(event.type)) requestPush();
		}) ?? (() => {});
		tickTimer = setInterval(() => requestPush(0), tickMs);
		tickTimer.unref?.();
		requestPush(startDelayMs);
	}

	function stop(): void {
		unsubscribe?.();
		unsubscribe = null;
		if (tickTimer) clearInterval(tickTimer);
		tickTimer = null;
		clearPending();
		if (device?.timer) clearTimeout(device.timer);
	}

	return { status, requestPush, pushNow, startDeviceLogin, connectRepo, disconnect, start, stop };
}

export type BackupSync = ReturnType<typeof createBackupSync>;

// ─── the process singleton (globalThis-anchored: the Next multi-entry law) ───

interface BackupGlobal {
	__lhBackupSync?: BackupSync;
}

export function backupSync(): BackupSync {
	const g = globalThis as typeof globalThis & BackupGlobal;
	if (!g.__lhBackupSync) {
		g.__lhBackupSync = createBackupSync({
			clientId: GITHUB_OAUTH_CLIENT_ID,
			readSettings: () => settingsStore.readSettings()?.backup ?? {},
			writeSettings: (next) => {
				const record = settingsStore.readSettings() ?? { version: CURRENT_SETTINGS_VERSION };
				settingsStore.writeSettings({ ...record, backup: next });
			},
			token: () => keyValue(BACKUP_TOKEN_KEY),
			saveToken: (token) => {
				const saved = saveKey(BACKUP_TOKEN_KEY, token);
				if (!saved.ok) throw new Error(saved.error);
			},
			deleteToken: () => void deleteKey(BACKUP_TOKEN_KEY),
			readState: readBackupState,
			writeState: writeBackupState,
			collect: () => collectSnapshot(),
			onChange: () => emit("backup-changed", {}),
			subscribe,
		});
	}
	return g.__lhBackupSync;
}

/** Boot entry (instrumentation.ts): start the loop once per server process. */
export function startBackupSync(): void {
	backupSync().start();
}
