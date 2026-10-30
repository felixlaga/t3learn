/**
 * CLAUDE → CODEX (owner, 2026-10-30): a Claude call that hits the usage
 * limit reruns on Codex; while the limit lasts, calls go straight to
 * Codex; anything else passes through untouched.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createFauxCore, type AssistantMessageEvent } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { emptyCliMessage } from "../src/agent/cli-stream.ts";
import { claudeLimitedUntil, claudeWithFallback, noteClaudeLimited, resetClaudeLimit } from "../src/agent/claude-fallback.ts";
import type { AdmissionScope, SubscriptionDispatchLifecycle } from "../src/agent/subscription-request-cycle.ts";

const model = createFauxCore({}).getModel();
const scope: AdmissionScope = { accountId: "claude-code", epoch: 1, authorityRevision: 1, selectedModelId: "opus" };

function stream(build: () => AssistantMessageEvent[], before?: () => void): AssistantMessageEventStream {
	const out = new AssistantMessageEventStream();
	queueMicrotask(() => { before?.(); for (const event of build()) out.push(event); out.end(); });
	return out;
}
function failing(errorMessage: string) {
	return (lifecycle: SubscriptionDispatchLifecycle | undefined) => stream(() => {
		const message = { ...emptyCliMessage(model), stopReason: "error" as const, errorMessage };
		return [{ type: "start", partial: message }, { type: "error", reason: "error", error: message }];
	}, () => { lifecycle?.captured(scope); lifecycle?.beforeDispatch(scope); });
}
function answering(text: string, seen: Array<SubscriptionDispatchLifecycle | undefined>) {
	return { run: (lifecycle: SubscriptionDispatchLifecycle | undefined) => {
		seen.push(lifecycle);
		return stream(() => {
			const message = { ...emptyCliMessage(model), content: [{ type: "text" as const, text }] };
			return [{ type: "start", partial: message }, { type: "done", reason: "stop", message }];
		});
	} };
}
function recorder(): SubscriptionDispatchLifecycle & { calls: string[] } {
	const calls: string[] = [];
	return { calls, captured: () => calls.push("captured"), beforeDispatch: () => calls.push("dispatch"), noDispatch: () => calls.push("none") };
}
async function collect(events: AsyncIterable<AssistantMessageEvent>) {
	const out: AssistantMessageEvent[] = [];
	for await (const e of events) out.push(e);
	return out;
}

afterEach(() => resetClaudeLimit());

describe("the Claude → Codex fallback", () => {
	it("reruns a call that hit the usage limit on Codex, without a second dispatch", async () => {
		const seen: Array<SubscriptionDispatchLifecycle | undefined> = [];
		const lifecycle = recorder();
		const events = await collect(claudeWithFallback(failing("CLI subscription usage limit reached."), () => answering("from codex", seen), lifecycle));
		assert.deepEqual(events.map((e) => e.type), ["start", "done"]);
		assert.equal((events[1] as { message: { content: Array<{ text: string }> } }).message.content[0]!.text, "from codex");
		assert.deepEqual(seen, [undefined], "the request cycle already counted Claude's dispatch");
		assert.deepEqual(lifecycle.calls, ["captured", "dispatch"]);
		assert.ok(claudeLimitedUntil(), "the limit is remembered");
	});

	it("goes straight to Codex while the limit lasts, and lets Codex own the dispatch", async () => {
		noteClaudeLimited(Date.now() / 1000 + 3600);
		const seen: Array<SubscriptionDispatchLifecycle | undefined> = [];
		const lifecycle = recorder();
		let claudeCalled = false;
		const events = await collect(claudeWithFallback(() => { claudeCalled = true; return failing("x")(undefined); }, () => answering("direct", seen), lifecycle));
		assert.equal(claudeCalled, false);
		assert.deepEqual(events.map((e) => e.type), ["start", "done"]);
		assert.deepEqual(seen, [lifecycle]);
	});

	it("passes any other error through untouched", async () => {
		const seen: Array<SubscriptionDispatchLifecycle | undefined> = [];
		const events = await collect(claudeWithFallback(failing("Your CLI needs sign-in."), () => answering("never", seen), recorder()));
		assert.deepEqual(events.map((e) => e.type), ["start", "error"]);
		assert.equal(seen.length, 0);
		assert.equal(claudeLimitedUntil(), null);
	});

	it("passes the limit error through when Codex is not connected", async () => {
		const events = await collect(claudeWithFallback(failing("CLI subscription usage limit reached."), () => undefined, recorder()));
		assert.deepEqual(events.map((e) => e.type), ["start", "error"]);
	});

	it("comes back to Claude once the limit resets", () => {
		noteClaudeLimited(Date.now() - 1000);
		assert.equal(claudeLimitedUntil(), null, "a reset time in the past is no limit");
		noteClaudeLimited(Date.now() + 60_000);
		assert.equal(claudeLimitedUntil(Date.now() + 120_000), null);
	});
});
