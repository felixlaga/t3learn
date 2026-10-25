import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { query, type Options, type SDKUserMessage, type AccountInfo } from "@anthropic-ai/claude-agent-sdk";
import type { Api, Model } from "@earendil-works/pi-ai";
import { CLI_PROVIDERS, type CliProviderConfig, type CliProviderId, type CliProviderStatus } from "../core/contracts/cli-providers.ts";
import { PATHS } from "../../config.ts";
import { CodexRpc, cliEnvironment, resolveCliBinary } from "./cli-process.ts";
import type { AdmissionScope } from "./subscription-request-cycle.ts";

interface Entry {
	config: CliProviderConfig; connected: boolean; models: Model<Api>[]; revision: number;
	message?: string; authorizationUrl?: string; pending?: { cancel(): void };
	probe?: Promise<void>; checked: number; identity?: string;
}
const KEY = Symbol.for("lh.cli.providers");
const globals = globalThis as typeof globalThis & { [KEY]?: { entries: Map<CliProviderId, Entry>; listeners: Set<() => void>; active: Map<AbortController, { id: CliProviderId; background: boolean }> } };
const state = globals[KEY] ??= { entries: new Map(), listeners: new Set(), active: new Map() };
function entry(id: CliProviderId): Entry {
	if (!state.entries.has(id)) state.entries.set(id, { config: { enabled: false, binaryPath: "", allowBackgroundUse: true }, connected: false, models: [], revision: 0, checked: 0 });
	return state.entries.get(id)!;
}
function invalidate(id: CliProviderId) {
	entry(id).revision++;
	for (const [abort, owner] of state.active) if (owner.id === id) abort.abort("all");
}
function changed() { for (const listener of state.listeners) listener(); }
export function onCliChange(listener: () => void) { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; }
export function configureCli(id: CliProviderId, config: CliProviderConfig) {
	const e = entry(id);
	if (JSON.stringify(e.config) === JSON.stringify(config)) return;
	const identityChanged = e.config.enabled !== config.enabled || e.config.binaryPath !== config.binaryPath;
	e.config = { ...config };
	if (identityChanged) { e.pending?.cancel(); e.connected = false; e.models = []; e.revision++; e.checked = 0; }
	for (const [abort, owner] of state.active) if (owner.id === id && (identityChanged || (owner.background && !config.allowBackgroundUse))) abort.abort(identityChanged ? "all" : "background");
	changed();
}
export function cliStatus(): CliProviderStatus[] {
	return CLI_PROVIDERS.map(({ id }) => { const e = entry(id); return { id, ...e.config, connected: e.connected, pending: !!e.pending, modelCount: e.models.length, message: e.message, authorizationUrl: e.authorizationUrl }; });
}
export function cliConnected(id: CliProviderId) { const e = entry(id); return e.config.enabled && e.connected; }
export function cliBackgroundAllowed(id: CliProviderId) { return cliConnected(id) && entry(id).config.allowBackgroundUse; }
export function cliModels() { return CLI_PROVIDERS.flatMap(({ id }) => cliConnected(id) ? entry(id).models : []); }
export function cliModel(id: CliProviderId, modelId: string) { return cliModels().find((m) => m.provider === id && m.id === modelId); }
export function cliScope(id: CliProviderId, modelId: string): AdmissionScope {
	if (!cliModel(id, modelId)) throw new Error("CLI connection is unavailable. Reconnect in Providers.");
	return { accountId: id, epoch: entry(id).revision, authorityRevision: entry(id).revision, selectedModelId: modelId };
}
export function cliScopeCurrent(id: CliProviderId, scope: AdmissionScope) {
	try { return JSON.stringify(cliScope(id, scope.selectedModelId)) === JSON.stringify(scope); } catch { return false; }
}
export function cliWorkController(id: CliProviderId, background: boolean) {
	const controller = new AbortController(); state.active.set(controller, { id, background });
	return { controller, release: () => { state.active.delete(controller); } };
}
export function assertClaudeSubscription(account: AccountInfo) {
	if (!account.subscriptionType || account.apiKeySource && account.apiKeySource !== "none" || account.apiProvider && account.apiProvider !== "firstParty") throw new Error("Sign in with your Claude subscription using claude auth login.");
}
export function assertCliIdentity(id: CliProviderId, account: unknown) {
	const e = entry(id);
	if (e.identity !== createHash("sha256").update(JSON.stringify(account)).digest("hex")) {
		invalidate(id); e.connected = false; e.models = []; e.checked = 0; changed();
		throw new Error("CLI login changed. Refresh the connection.");
	}
}
export function cliWorkingDirectory() { const cwd = path.join(PATHS.data, "cli-workspace"); mkdirSync(cwd, { recursive: true }); return cwd; }
export function cliBinary(id: CliProviderId) { return resolveCliBinary(id === "codex-cli" ? "codex" : "claude", entry(id).config.binaryPath); }
export function claudeOptions(binary: string, abortController: AbortController): Options {
	return {
		pathToClaudeCodeExecutable: binary, abortController, cwd: cliWorkingDirectory(),
		persistSession: false, settingSources: [], settings: { disableAllHooks: true },
		tools: [], mcpServers: {}, strictMcpConfig: true, permissionMode: "dontAsk",
		env: cliEnvironment(), stderr: () => {},
	};
}
export function safeLoginUrl(value: string): string | undefined {
	try { const u = new URL(value); return u.protocol === "https:" && (!u.port || u.port === "443") && !u.username && !u.password && ["auth.openai.com", "auth0.openai.com", "claude.ai", "platform.claude.com", "console.anthropic.com"].includes(u.hostname) ? u.href : undefined; } catch { return undefined; }
}
function catalogModel(id: CliProviderId, modelId: string, name: string, levels: string[], templates: readonly Model<Api>[]): Model<Api> {
	const base = templates.find((m) => m.id === modelId);
	return { ...base, id: modelId, name, provider: id, api: "learnharness-cli", baseUrl: "", input: base?.input ?? ["text", "image"],
		// Runtime catalogs establish selectable models. Context limits are only known when Pi has matching metadata.
		contextWindow: base?.contextWindow ?? 0, maxTokens: base?.maxTokens ?? 0, reasoning: levels.length > 0,
		thinkingLevelMap: Object.fromEntries(["off", "minimal", "low", "medium", "high", "xhigh"].map((level) => [level, levels.includes(level) ? level : null])),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}
export async function refreshCli(id: CliProviderId, templates: readonly Model<Api>[], force = false) {
	const e = entry(id);
	if (!e.config.enabled || e.pending) return;
	if (e.probe) return e.probe;
	if (!force && Date.now() - e.checked < 30000) return;
	const revision = e.revision;
	e.probe = (async () => {
		let models: Model<Api>[] = [];
		let identity = "";
		try {
			const binary = cliBinary(id);
			if (id === "codex-cli") {
				const rpc = new CodexRpc(binary, cliWorkingDirectory());
				try {
					await rpc.initialize();
					const account = await rpc.request("account/read", {});
					if (!account.account || account.account.type !== "chatgpt") throw new Error("Sign in with your ChatGPT subscription using codex login.");
					identity = JSON.stringify(account.account);
					let cursor: string | undefined;
					for (let page = 0; page < 30; page++) {
						const list = await rpc.request("model/list", cursor ? { cursor } : {});
						models.push(...(list.data ?? []).filter((m: any) => !m.hidden).map((m: any) => catalogModel(id, m.model ?? m.id, m.displayName ?? m.id, (m.supportedReasoningEfforts ?? []).map((r: any) => r.reasoningEffort), templates)));
						cursor = list.nextCursor; if (!cursor) break;
					}
				} finally { rpc.close(); }
			} else {
				const abort = new AbortController();
				const timer = setTimeout(() => abort.abort(), 20000);
				// T3's never-yielding probe initializes locally without spending a model request.
				let q: ReturnType<typeof query> | undefined;
				try {
				q = query({ prompt: (async function* (): AsyncGenerator<SDKUserMessage> { await new Promise<void>((resolve) => abort.signal.addEventListener("abort", () => resolve(), { once: true })); })(), options: claudeOptions(binary, abort) });
					const init = await q.initializationResult();
					assertClaudeSubscription(init.account);
					identity = JSON.stringify(init.account);
					models = init.models.map((m) => catalogModel(id, m.value, m.displayName, m.supportedEffortLevels ?? [], templates.map((t) => t.id === m.resolvedModel ? { ...t, id: m.value } : t)));
				} finally { clearTimeout(timer); abort.abort(); q?.close(); }
			}
			if (!models.length) throw new Error("The CLI returned no models. Update it and refresh.");
			if (revision !== e.revision) return;
			const fingerprint = createHash("sha256").update(identity).digest("hex");
			if (e.identity && e.identity !== fingerprint) invalidate(id);
			e.identity = fingerprint;
			e.models = models; e.connected = true; e.message = "Connected through your CLI subscription.";
		} catch (error) {
			if (revision !== e.revision) return;
			if (e.connected) invalidate(id);
			e.connected = false; e.models = [];
			const message = error instanceof Error ? error.message : "";
			e.message = /^(Sign in|Use an absolute|The CLI returned|codex is not installed|claude is not installed)/.test(message) ? message : "Could not verify the CLI connection. Check its path, sign in in Terminal, then refresh.";
		} finally { e.checked = revision === e.revision ? Date.now() : 0; e.probe = undefined; changed(); }
	})();
	return e.probe;
}
export function cancelCliLogin(id: CliProviderId) { entry(id).pending?.cancel(); }
export async function startCliLogin(id: CliProviderId, onComplete: () => Promise<void>) {
	const e = entry(id);
	if (e.pending) return;
	const binary = cliBinary(id);
	let rpc: CodexRpc | undefined, child: ChildProcess | undefined;
	const attempt = { cancel: () => finish("Sign-in cancelled.") };
	const timer = setTimeout(() => finish("Sign-in timed out. Try again."), 180000);
	function finish(message: string, success = false) {
		if (e.pending !== attempt) return;
		clearTimeout(timer); e.pending = undefined; e.authorizationUrl = undefined; e.message = message; e.checked = 0;
		rpc?.close(); child?.kill("SIGTERM"); changed();
		if (success) void onComplete().catch(() => { e.message = "Sign-in completed; refresh to check the connection."; changed(); });
	}
	invalidate(id); e.connected = false; e.models = [];
	e.pending = attempt; e.message = "Finish sign-in in your browser."; changed();
	try {
		if (id === "codex-cli") {
			rpc = new CodexRpc(binary, cliWorkingDirectory());
			rpc.onFailure(() => finish("Sign-in failed. Try codex login in Terminal, then refresh."));
			rpc.onMessage((frame) => { if (frame.method === "account/login/completed") finish(frame.params?.success ? "Sign-in completed." : "Sign-in failed.", frame.params?.success === true); });
			await rpc.initialize();
			const result = await rpc.request("account/login/start", { type: "chatgpt" });
			if (e.pending === attempt) e.authorizationUrl = safeLoginUrl(result.authUrl);
		} else {
			child = spawn(binary, ["auth", "login"], { cwd: cliWorkingDirectory(), env: cliEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
			let tail = "";
			const receive = (chunk: Buffer) => {
				tail = (tail + chunk.toString()).slice(-16384);
				for (const match of tail.matchAll(/https:\/\/[^\s\u001b<>]+/g)) { const url = safeLoginUrl(match[0]); if (url && e.pending === attempt) e.authorizationUrl = url; }
				changed();
			};
			child.stdout?.on("data", receive); child.stderr?.on("data", receive);
			child.on("error", () => finish("Could not start Claude sign-in. Check the executable path."));
			child.on("exit", (code) => finish(code === 0 ? "Sign-in completed." : "Sign-in did not complete. Run claude auth login in Terminal, then refresh.", code === 0));
		}
		changed();
	} catch { finish("Could not start sign-in. Check the CLI installation and try again."); }
}
