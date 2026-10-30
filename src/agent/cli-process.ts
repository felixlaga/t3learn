import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

/** T3's CLI route retains HOME for macOS Keychain. API keys cannot silently
 * turn a selected subscription connection into metered API access. The
 * backup's GitHub token never reaches a lesson's agent (2026-10-30). */
export function cliEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env = { ...base };
	for (const key of Object.keys(env)) {
		if (/^(OPENAI_API_KEY|OPENAI_BASE_URL|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_.*|CLAUDECODE|LH_DESKTOP_API_SECRET|GITHUB_BACKUP_TOKEN)$/.test(key)) delete env[key];
	}
	env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
	env.CLAUDE_CODE_AUTO_CONNECT_IDE = "0";
	env.CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL = "1";
	return env;
}

/** Finder-launched apps do not inherit a terminal's PATH. Never invoke a shell. */
export function resolveCliBinary(command: string, configured = ""): string {
	const candidate = configured.trim();
	if (candidate) {
		const expanded = candidate.startsWith("~/") ? path.join(homedir(), candidate.slice(2)) : candidate;
		if (!path.isAbsolute(expanded)) throw new Error("Use an absolute executable path.");
		accessSync(expanded, constants.X_OK);
		return expanded;
	}
	const dirs = [...(process.env.PATH ?? "").split(path.delimiter), path.join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
	for (const dir of dirs.filter(Boolean)) {
		const file = path.join(dir, command);
		try { accessSync(file, constants.X_OK); return file; } catch { /* next location */ }
	}
	throw new Error(`${command} is not installed. Install it or set its executable path.`);
}

export interface RpcFrame { id?: number | string; method?: string; params?: any; result?: any; error?: { message?: string } }
/** Newline JSON-RPC transport used by T3's Codex app-server integration. */
export class CodexRpc {
	private child: ChildProcessWithoutNullStreams;
	private counter = 0;
	private closed = false;
	private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
	private listeners = new Set<(frame: RpcFrame) => void>();
	private failures = new Set<(error: Error) => void>();
	constructor(binary: string, cwd: string, env = cliEnvironment(), spawnProcess = spawn) {
		this.child = spawnProcess(binary, ["app-server"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
		this.child.stderr.resume(); // Provider diagnostics may contain credentials; never forward them.
		const lines = createInterface({ input: this.child.stdout });
		lines.on("line", (line) => {
			let frame: RpcFrame;
			try { frame = JSON.parse(line); } catch { return; }
			if (typeof frame.id === "number" && !frame.method && this.pending.has(frame.id)) {
				const pending = this.pending.get(frame.id)!; this.pending.delete(frame.id); clearTimeout(pending.timer);
				if (frame.error) pending.reject(new Error(frame.error.message ?? "Codex request failed."));
				else pending.resolve(frame.result);
			} else for (const listener of this.listeners) listener(frame);
		});
		this.child.on("error", () => this.fail(new Error("Codex could not start. Check the executable path.")));
		this.child.on("exit", () => this.fail(new Error("Codex closed before completing the request.")));
		this.child.stdin.on("error", () => this.fail(new Error("Codex connection closed.")));
	}
	private fail(error: Error) {
		for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
		this.pending.clear();
		if (!this.closed) for (const listener of this.failures) listener(error);
	}
	onMessage(listener: (frame: RpcFrame) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	onFailure(listener: (error: Error) => void) { this.failures.add(listener); return () => this.failures.delete(listener); }
	send(frame: RpcFrame) {
		if (this.closed) throw new Error("Codex connection closed.");
		this.child.stdin.write(JSON.stringify(frame) + "\n");
	}
	request(method: string, params: unknown = {}): Promise<any> {
		return new Promise((resolve, reject) => {
			const id = ++this.counter;
			const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, 20000);
			this.pending.set(id, { resolve, reject, timer });
			try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
		});
	}
	async initialize() {
		await this.request("initialize", { clientInfo: { name: "learnharness", title: "LearnHarness", version: "0.3.7" }, capabilities: { experimentalApi: true } });
		this.send({ method: "initialized" });
	}
	close() {
		if (this.closed) return;
		this.closed = true; this.fail(new Error("Codex connection closed."));
		this.child.stdin.end(); this.child.kill("SIGTERM");
		const timer = setTimeout(() => { if (this.child.exitCode === null) this.child.kill("SIGKILL"); }, 1500);
		timer.unref(); this.listeners.clear(); this.failures.clear();
	}
}
