/**
 * The automatic backup loop (src/server/backup.ts) run for real against a
 * loopback fake of GitHub (REST + Git Data API + the device flow) and a
 * scratch data directory. Only the world is replaced: settings, state and
 * the token live in memory; the snapshot is collected from real files.
 * Pins: the device sign-in lands a token and the login; connecting
 * creates a PRIVATE repository and pushes a full first snapshot; the
 * next push is incremental (base tree, deletions as sha null); an
 * unchanged snapshot pushes nothing; a public repository and the
 * fresh-install case are refused before any blob is written; a moved
 * branch is retried once; disconnect forgets the token and turns the
 * loop off.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBackupSync, type BackupSyncDeps } from "../src/server/backup.ts";
import { collectSnapshot, EMPTY_BACKUP_STATE, type BackupState } from "../src/store/backup.ts";
import type { BackupSettings } from "../src/core/backup.ts";

type Tree = { base_tree?: string; tree: { path: string; sha: string | null }[] };
type Commit = { message: string; tree: string; parents: string[] };

/** The fake GitHub: enough of the API for one account and its repositories. */
function fakeGitHub() {
	const repos = new Map<string, { private: boolean; head: string | null }>();
	const blobs = new Map<string, string>();
	const trees = new Map<string, Tree>();
	const commits = new Map<string, Commit>();
	const requests: { method: string; url: string; body: unknown }[] = [];
	let device: { pollsBeforeToken: number; polls: number } = { pollsBeforeToken: 2, polls: 0 };
	let seq = 0;
	let failNextRefUpdate = false;
	const sha = (prefix: string) => `${prefix}${String(++seq).padStart(38, "0")}`.slice(0, 40);

	const server = http.createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
			const url = req.url ?? "";
			const method = req.method ?? "GET";
			requests.push({ method, url, body });
			const json = (status: number, payload: unknown) => {
				res.writeHead(status, { "content-type": "application/json" });
				res.end(JSON.stringify(payload));
			};
			const auth = req.headers.authorization;
			// interval 1: GitHub's real answer is 5, and the client treats 0 as "unset" and uses 5.
			if (url.startsWith("/login/device/code")) return json(200, { device_code: "dev-123", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 });
			if (url.startsWith("/login/oauth/access_token")) {
				device.polls += 1;
				if (device.polls === 1) return json(200, { error: "slow_down", interval: 1 });
				if (device.polls <= device.pollsBeforeToken) return json(200, { error: "authorization_pending" });
				return json(200, { access_token: "gho_testtoken_abcdefghijklmnop", token_type: "bearer", scope: "repo" });
			}
			if (auth !== "Bearer gho_testtoken_abcdefghijklmnop" && auth !== "Bearer ghp_pastedtoken_abcdefghijklmnop") return json(401, { message: "Bad credentials" });
			if (url === "/user") return json(200, { login: "felix" });
			if (url === "/user/repos" && method === "POST") {
				const name = String(body!.name);
				repos.set(name, { private: body!.private === true, head: null });
				return json(201, { private: body!.private, full_name: `felix/${name}`, default_branch: "main", html_url: `https://github.com/felix/${name}` });
			}
			const m = url.match(/^\/repos\/felix\/([^/]+)(\/.*)?$/);
			if (!m) return json(404, { message: "Not Found" });
			const repo = repos.get(m[1]!);
			const rest = m[2] ?? "";
			if (!repo) return json(404, { message: "Not Found" });
			if (rest === "") return json(200, { private: repo.private, full_name: `felix/${m[1]}`, default_branch: "main", html_url: `https://github.com/felix/${m[1]}` });
			if (rest === "/git/ref/heads/main") return repo.head ? json(200, { object: { sha: repo.head } }) : json(409, { message: "Git Repository is empty." });
			if (rest.startsWith("/git/commits/") && method === "GET") {
				const commit = commits.get(rest.slice("/git/commits/".length));
				return commit ? json(200, { sha: rest.slice(13), tree: { sha: commit.tree } }) : json(404, { message: "no commit" });
			}
			if (rest === "/git/blobs") {
				const id = sha("b");
				blobs.set(id, Buffer.from(String(body!.content), "base64").toString("utf8"));
				return json(201, { sha: id });
			}
			if (rest === "/git/trees") {
				const id = sha("t");
				trees.set(id, body as unknown as Tree);
				return json(201, { sha: id });
			}
			if (rest === "/git/commits" && method === "POST") {
				const id = sha("c");
				commits.set(id, body as unknown as Commit);
				return json(201, { sha: id });
			}
			if (rest === "/git/refs" && method === "POST") {
				if (repo.head) return json(422, { message: "Reference already exists" });
				repo.head = String(body!.sha);
				return json(201, { ref: body!.ref });
			}
			if (rest === "/git/refs/heads/main" && method === "PATCH") {
				if (failNextRefUpdate) {
					failNextRefUpdate = false;
					repo.head = sha("x"); // someone else moved the branch
					commits.set(repo.head, { message: "foreign", tree: sha("t"), parents: [] });
					return json(422, { message: "Update is not a fast forward" });
				}
				repo.head = String(body!.sha);
				return json(200, { object: { sha: repo.head } });
			}
			return json(404, { message: `unhandled ${method} ${url}` });
		});
	});
	return {
		server,
		repos,
		blobs,
		trees,
		commits,
		requests,
		setDevice: (pollsBeforeToken: number) => (device = { pollsBeforeToken, polls: 0 }),
		failNextRefUpdate: () => (failNextRefUpdate = true),
		treeOf(commitSha: string) {
			return trees.get(commits.get(commitSha)!.tree)!;
		},
	};
}

async function until(check: () => boolean, label: string, ms = 5_000) {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}

describe("backup sync against a loopback GitHub", () => {
	const gh = fakeGitHub();
	let base = "";
	let dataDir = "";
	before(async () => {
		await new Promise<void>((r) => gh.server.listen(0, "127.0.0.1", r));
		base = `http://127.0.0.1:${(gh.server.address() as { port: number }).port}`;
		dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-backup-sync-"));
		fs.mkdirSync(path.join(dataDir, "chats"), { recursive: true });
		fs.mkdirSync(path.join(dataDir, "graph"), { recursive: true });
		fs.writeFileSync(path.join(dataDir, "chats", "chat_a.json"), '{"id":"chat_a"}\n');
		fs.writeFileSync(path.join(dataDir, "chats", "chat_b.json"), '{"id":"chat_b"}\n');
		fs.writeFileSync(path.join(dataDir, "graph", "nodes.jsonl"), '{"id":"n1"}\n');
		fs.writeFileSync(path.join(dataDir, "auth.json"), '{"SECRET":"never"}\n');
		fs.writeFileSync(path.join(dataDir, "learning.json"), '{"version":1}\n');
	});
	after(() => {
		gh.server.close();
		fs.rmSync(dataDir, { recursive: true, force: true });
	});

	function harness(overrides: Partial<BackupSyncDeps> = {}) {
		let settings: BackupSettings = {};
		let state: BackupState = { ...EMPTY_BACKUP_STATE };
		let token: string | undefined;
		let changes = 0;
		const logs: string[] = [];
		const sync = createBackupSync({
			clientId: "Iv1.fake",
			readSettings: () => settings,
			writeSettings: (next) => (settings = next),
			token: () => token,
			saveToken: (t) => (token = t),
			deleteToken: () => (token = undefined),
			readState: () => state,
			writeState: (next) => (state = next),
			collect: () => collectSnapshot(dataDir),
			apiBase: base,
			webBase: base,
			debounceMs: 10,
			retryMs: 60_000,
			tickMs: 60_000,
			startDelayMs: 60_000,
			log: (line) => logs.push(line),
			onChange: () => (changes += 1),
			...overrides,
		});
		return { sync, logs, settings: () => settings, state: () => state, token: () => token, setToken: (t?: string) => (token = t), changes: () => changes };
	}

	it("the device sign-in lands the token and the login; connecting creates a PRIVATE repository and pushes the full snapshot", async () => {
		const h = harness();
		gh.setDevice(1);
		const started = await h.sync.startDeviceLogin();
		assert.equal(started.device?.userCode, "ABCD-1234");
		assert.equal(started.connected, false);
		await until(() => h.token() !== undefined, "the token");
		await until(() => h.state().login === "felix", "the login");
		assert.equal(h.sync.status().device, null, "the code screen goes away");

		const connected = await h.sync.connectRepo("t3learn-data");
		assert.equal(connected.repo, "t3learn-data");
		assert.equal(connected.enabled, true);
		assert.equal(connected.repoUrl, "https://github.com/felix/t3learn-data");
		const create = gh.requests.find((r) => r.method === "POST" && r.url === "/user/repos");
		assert.equal((create?.body as { private: boolean }).private, true, "created private");

		await until(() => h.state().lastCommit !== null, "the first push");
		const head = gh.repos.get("t3learn-data")!.head!;
		assert.equal(h.state().lastCommit, head);
		const tree = gh.treeOf(head);
		assert.equal(tree.base_tree, undefined, "a full tree, no base");
		const paths = tree.tree.map((e) => e.path).sort();
		assert.deepEqual(paths, ["README.md", "snapshot/chats/chat_a.json", "snapshot/chats/chat_b.json", "snapshot/graph/nodes.jsonl", "snapshot/learning.json", "snapshot/manifest.json"]);
		assert.ok(!paths.some((p) => p.includes("auth.json")), "credentials never leave");
		const manifestSha = tree.tree.find((e) => e.path === "snapshot/manifest.json")!.sha!;
		const manifest = JSON.parse(gh.blobs.get(manifestSha)!) as { schema: number; files: { path: string; sha256: string }[] };
		assert.equal(manifest.schema, 1);
		assert.deepEqual(manifest.files.map((f) => f.path), ["chats/chat_a.json", "chats/chat_b.json", "graph/nodes.jsonl", "learning.json"]);
		assert.equal(gh.commits.get(head)!.parents.length, 0, "the first commit has no parent");
		assert.equal(h.state().files.length, 4);
		assert.ok(h.changes() >= 3, "status changes were announced");
		h.sync.stop();
	});

	it("the next push is incremental: changed blobs, deletions as sha null, parent = our last commit; unchanged pushes nothing", async () => {
		const h = harness();
		h.setToken("gho_testtoken_abcdefghijklmnop");
		await h.sync.connectRepo("incremental");
		await until(() => h.state().lastCommit !== null, "the first push");
		const first = h.state().lastCommit!;
		const commitsBefore = gh.commits.size;

		const same = await h.sync.pushNow();
		assert.equal(gh.commits.size, commitsBefore, "nothing changed, nothing committed");
		assert.equal(same.lastCommit, first);

		fs.writeFileSync(path.join(dataDir, "chats", "chat_a.json"), '{"id":"chat_a","v":2}\n');
		fs.unlinkSync(path.join(dataDir, "chats", "chat_b.json"));
		fs.writeFileSync(path.join(dataDir, "chats", "chat_c.json"), '{"id":"chat_c"}\n');
		const after = await h.sync.pushNow();
		assert.notEqual(after.lastCommit, first);
		const tree = gh.treeOf(after.lastCommit!);
		assert.equal(tree.base_tree, gh.commits.get(first)!.tree, "built on the last pushed tree");
		const entries = Object.fromEntries(tree.tree.map((e) => [e.path, e.sha]));
		assert.ok(entries["snapshot/chats/chat_a.json"], "changed record written");
		assert.ok(entries["snapshot/chats/chat_c.json"], "new record written");
		assert.equal(entries["snapshot/chats/chat_b.json"], null, "deleted record removed");
		assert.ok(entries["snapshot/manifest.json"], "the manifest always moves");
		assert.equal("README.md" in entries, false, "README untouched on an incremental push");
		assert.deepEqual(gh.commits.get(after.lastCommit!)!.parents, [first]);
		assert.match(gh.commits.get(after.lastCommit!)!.message, /2 records updated, 1 removed/);
		fs.writeFileSync(path.join(dataDir, "chats", "chat_b.json"), '{"id":"chat_b"}\n');
		fs.unlinkSync(path.join(dataDir, "chats", "chat_c.json"));
		h.sync.stop();
	});

	it("a public repository is refused before any blob is written; a repository with history is not overwritten by an app with no records", async () => {
		gh.repos.set("public-notes", { private: false, head: null });
		const h = harness();
		h.setToken("ghp_pastedtoken_abcdefghijklmnop");
		await assert.rejects(h.sync.connectRepo("public-notes"), /public/);
		assert.equal(h.settings().repo, undefined, "nothing was enabled");

		const blobsBefore = gh.blobs.size;
		gh.repos.set("flipped", { private: true, head: null });
		await h.sync.connectRepo("flipped");
		await until(() => h.state().lastCommit !== null, "the first push");
		gh.repos.get("flipped")!.private = false; // flipped public after the fact
		fs.writeFileSync(path.join(dataDir, "learning.json"), '{"version":1,"revision":2}\n');
		const blobsAfterFirst = gh.blobs.size;
		const refused = await h.sync.pushNow();
		assert.match(refused.lastError ?? "", /not private/);
		assert.equal(gh.blobs.size, blobsAfterFirst, "no blob left the machine");
		assert.ok(gh.blobs.size > blobsBefore);

		const empty = fs.mkdtempSync(path.join(os.tmpdir(), "lh-backup-empty-"));
		const fresh = harness({ collect: () => collectSnapshot(empty) });
		fresh.setToken("ghp_pastedtoken_abcdefghijklmnop");
		gh.repos.get("incremental")!.private = true;
		await fresh.sync.connectRepo("incremental");
		await until(() => fresh.state().lastError !== null, "the guard");
		assert.match(fresh.state().lastError ?? "", /already holds a backup/);
		assert.equal(fresh.state().lastCommit, null);
		fs.rmSync(empty, { recursive: true, force: true });
		h.sync.stop();
		fresh.sync.stop();
	});

	it("a branch moved under the push is retried once on the new head; disconnect forgets the token and turns the loop off", async () => {
		const h = harness();
		h.setToken("gho_testtoken_abcdefghijklmnop");
		await h.sync.connectRepo("moving");
		await until(() => h.state().lastCommit !== null, "the first push");
		fs.writeFileSync(path.join(dataDir, "learning.json"), '{"version":1,"revision":3}\n');
		gh.failNextRefUpdate();
		const result = await h.sync.pushNow();
		assert.equal(result.lastError, null, "the retry succeeded");
		assert.equal(result.lastCommit, gh.repos.get("moving")!.head);
		assert.ok(h.logs.some((l) => l.includes("retrying once")));
		assert.equal(gh.treeOf(result.lastCommit!).base_tree, undefined, "a foreign head means a full rebuild");

		const off = h.sync.disconnect();
		assert.equal(off.connected, false);
		assert.equal(off.enabled, false);
		assert.equal(off.repo, "moving", "the name is kept for a later reconnect");
		assert.equal(h.token(), undefined);
		h.sync.stop();
	});

	it("start() pushes on bus events after the debounce, and does nothing while unconfigured", async () => {
		const listeners: ((e: { type: string }) => void)[] = [];
		const h = harness({
			subscribe: (listener) => {
				listeners.push(listener as (e: { type: string }) => void);
				return () => {};
			},
		});
		h.sync.start();
		listeners[0]!({ type: "chats-changed" });
		await new Promise((r) => setTimeout(r, 40));
		assert.equal(h.state().lastCommit, null, "unconfigured: nothing happens");
		h.setToken("gho_testtoken_abcdefghijklmnop");
		await h.sync.connectRepo("events");
		await until(() => h.state().lastCommit !== null, "the first push");
		const first = h.state().lastCommit;
		fs.writeFileSync(path.join(dataDir, "learning.json"), '{"version":1,"revision":4}\n');
		listeners[0]!({ type: "turn-settled" });
		assert.equal(h.sync.status().pending, true, "the debounce is armed");
		await until(() => h.state().lastCommit !== first, "the debounced push");
		h.sync.stop();
	});
});
