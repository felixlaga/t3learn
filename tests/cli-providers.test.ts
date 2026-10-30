import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cliEnvironment, resolveCliBinary } from "../src/agent/cli-process.ts";
import { configureCli, refreshCli, cliModel, cliStatus, cliScope, cliScopeCurrent, startCliLogin, cancelCliLogin, safeLoginUrl, assertCliIdentity } from "../src/agent/cli-providers.ts";
import { cliContext, cliStream, cliStreamError } from "../src/agent/cli-stream.ts";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { isSubscriptionModel, subscriptionLabel } from "../src/core/prices.ts";
import { cliRequestAllowed } from "../src/server/cli-providers.ts";

const binary = fileURLToPath(new URL("./fixtures/cli-codex.mjs", import.meta.url));
chmodSync(binary, 0o755);
const config = { enabled: true, binaryPath: binary, allowBackgroundUse: true };
const tool = { name: "learning_check", description: "Learning check", parameters: { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] } };
const context = (text: string, tools = false) => ({ messages: [{ role: "system", content: "Teach.", timestamp: 0, ...(tools ? { toolsAdded: [tool] } : {}) }, { role: "user", content: text, timestamp: 1 }] }) as unknown as TranscriptContext;
async function connect() { configureCli("codex-cli", config); await refreshCli("codex-cli", [], true); return cliModel("codex-cli", "fixture")!; }

test("CLI children retain Keychain home and omit API overrides and desktop capabilities", () => {
	const env = cliEnvironment({ NODE_ENV: "test", HOME: "/home/test", CLAUDE_CONFIG_DIR: "/claude", CODEX_HOME: "/codex", PATH: "/bin", OPENAI_API_KEY: "secret", ANTHROPIC_API_KEY: "secret", ANTHROPIC_AUTH_TOKEN: "secret", CLAUDE_CODE_OAUTH_TOKEN: "secret", LH_DESKTOP_API_SECRET: "secret", GITHUB_BACKUP_TOKEN: "secret", CLAUDECODE: "1" });
	assert.equal(env.HOME, "/home/test"); assert.equal(env.CLAUDE_CONFIG_DIR, "/claude"); assert.equal(env.CODEX_HOME, "/codex");
	assert.ok(!JSON.stringify(env).includes("secret")); assert.equal(env.CLAUDECODE, undefined);
	assert.throws(() => resolveCliBinary("codex", "codex; echo secret"), /absolute/);
});
test("browser launch URLs are HTTPS provider URLs only", () => {
	assert.ok(safeLoginUrl("https://auth.openai.com/authorize?state=123"));
	for (const url of ["file:///tmp/test", "javascript:alert(1)", "https://auth.openai.com.evil.test", "https://user:secret@claude.ai/oauth", "http://claude.ai"]) assert.equal(safeLoginUrl(url), undefined);
});
test("CLI control endpoint rejects remote hosts and cross-origin requests", () => {
	assert.ok(cliRequestAllowed(new Request("http://localhost:3000/api/cli-providers", { headers: { origin: "http://localhost:3000" } })));
	assert.equal(cliRequestAllowed(new Request("http://localhost:3000/api/cli-providers", { headers: { origin: "https://evil.test" } })), false);
	assert.equal(cliRequestAllowed(new Request("https://remote.test/api/cli-providers")), false);
	assert.ok(cliRequestAllowed(new Request("http://localhost:3000/api/cli-providers", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })));
	assert.equal(cliRequestAllowed(new Request("http://localhost:3000/api/cli-providers", { headers: { host: "evil.test", origin: "http://evil.test" } })), false);
});
test("transcript replay keeps tool results and images, updates sections, removes tools and omits private reasoning", () => {
	const input = context("Hello", true);
	input.messages.push({ role: "system", content: "New instruction", sections: { a: "new" }, toolsRemoved: [{ name: tool.name }], timestamp: 2 });
	input.messages.push({ role: "toolResult", toolCallId: "call", toolName: "learning_check", content: [{ type: "text", text: "Accepted" }, { type: "image", mimeType: "image/png", data: "aGVsbG8=" }], isError: false, timestamp: 3 });
	const result = cliContext(input);
	assert.equal(result.tools.length, 0); assert.match(result.instructions, /new/); assert.match(result.prompt, /Accepted/); assert.equal(result.images.length, 1); assert.ok(!result.prompt.includes("aGVsbG8="));
});
test("Codex JSON-RPC streams native tools, replays tool results, and accounts for cached tokens", async () => {
	const model = await connect(); assert.ok(model);
	const input = context("Submit the check", true);
	const first = await cliStream("codex-cli", () => false)(model, input).result();
	assert.equal(first.stopReason, "toolUse"); assert.deepEqual(first.content[0], { type: "toolCall", id: "fixture-call", name: "learning_check", arguments: { answer: 42 } });
	assert.equal(first.usage.input, 80); assert.equal(first.usage.cacheRead, 20);
	input.messages.push(first, { role: "toolResult", toolCallId: "fixture-call", toolName: "learning_check", content: [{ type: "text", text: "Correct" }], isError: false, timestamp: 2 });
	const next = await cliStream("codex-cli", () => false)(model, input).result();
	assert.equal(next.stopReason, "stop"); assert.deepEqual(next.content, [{ type: "text", text: "The answer is 42." }]);
});
test("failed and exited native turns never become successful answers or leak diagnostics", async () => {
	const model = await connect();
	for (const text of ["FAIL", "EXIT"]) {
		const message = await cliStream("codex-cli", () => false)(model, context(text)).result();
		assert.equal(message.stopReason, "error"); assert.ok(!message.errorMessage?.includes("private-token"));
	}
});
test("Stop closes a running request and returns aborted", async () => {
	const model = await connect();
	const message = await cliStream("codex-cli", () => false)(model, context("HANG"), { signal: AbortSignal.timeout(150) }).result();
	assert.equal(message.stopReason, "aborted");
});
test("background consent and disconnect invalidate admission without spending", async () => {
	const model = await connect(); const scope = cliScope("codex-cli", model.id);
	configureCli("codex-cli", { ...config, allowBackgroundUse: false });
	let admitted = false, denial = "";
	const result = await cliStream("codex-cli", () => true, { captured() {}, beforeDispatch() { admitted = true; }, noDispatch(kind) { denial = kind; } })(model, context("Hello")).result();
	assert.equal(result.stopReason, "error"); assert.equal(admitted, false); assert.equal(denial, "background");
	configureCli("codex-cli", { ...config, enabled: false }); assert.equal(cliScopeCurrent("codex-cli", scope), false);
});
test("login can be cancelled without logging out the shared terminal account", async () => {
	await connect(); await startCliLogin("codex-cli", async () => {});
	assert.equal(cliStatus()[0]?.pending, true); assert.match(cliStatus()[0]?.authorizationUrl ?? "", /^https:\/\/auth.openai.com/);
	cancelCliLogin("codex-cli"); assert.equal(cliStatus()[0]?.pending, false); assert.equal(cliStatus()[0]?.authorizationUrl, undefined);
});
test("CLI billing stays distinct from API-key billing", () => {
	assert.equal(subscriptionLabel("codex-cli:gpt"), "Codex CLI"); assert.equal(subscriptionLabel("claude-code:sonnet"), "Claude Code");
	assert.equal(isSubscriptionModel("openai:gpt"), false); assert.equal(isSubscriptionModel("anthropic:sonnet"), false);
	assert.match(cliStreamError(new Error("429 quota")), /usage limit/);
});

test("an external CLI account change invalidates the captured connection", async () => {
	const model = await connect(); const scope = cliScope("codex-cli", model.id);
	assert.throws(() => assertCliIdentity("codex-cli", { type: "chatgpt", email: "changed@example.test" }), /login changed/);
	assert.equal(cliScopeCurrent("codex-cli", scope), false);
});

test("Claude SDK initializes before releasing its synchronously-consumed prompt, and bridges learning tools", async () => {
	const binary = fileURLToPath(new URL("./fixtures/cli-claude.mjs", import.meta.url));
	configureCli("claude-code", { ...config, binaryPath: binary });
	await refreshCli("claude-code", [], true);
	const model = cliModel("claude-code", "fixture")!; assert.ok(model);
	const input = context("CHECK", true);
	let admitted = 0;
	const stream = cliStream("claude-code", () => false, { captured() {}, beforeDispatch() { admitted++; }, noDispatch() {} });
	const first = await stream(model, input).result();
	assert.equal(first.stopReason, "toolUse", first.errorMessage);
	assert.equal(admitted, 1);
	assert.deepEqual(first.content[0], { type: "toolCall", id: "claude-fixture-call", name: "learning_check", arguments: { answer: 42 } });
	input.messages.push(first, { role: "toolResult", toolCallId: "claude-fixture-call", toolName: "learning_check", content: [{ type: "text", text: "Correct" }], isError: false, timestamp: 2 });
	const next = await stream(model, input).result();
	assert.equal(next.stopReason, "stop", next.errorMessage);
	assert.deepEqual(next.content, [{ type: "text", text: "The answer is 42." }]);
	assert.equal(next.usage.totalTokens, 105);
	const aborted = await stream(model, context("HANG"), { signal: AbortSignal.timeout(150) }).result();
	assert.equal(aborted.stopReason, "aborted");
});
