/**
 * THE LEARNER TREE IN A REAL TURN (owner, 2026-10-30): the chat handler
 * hands every agent the notes in use ("How he learns") and the
 * remember_how_i_learn tool, bound to his words in this input. A note he
 * states is in the tree when the turn settles.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { stores } from "../src/server/stores.ts";
import { createLearnerStore } from "../src/store/learner.ts";
import { applyWritten, ensureSubject, GENERAL_BRANCH } from "../src/core/learner.ts";
import { handleChatRequest } from "../src/server/chat-handler.ts";
import { runningTurn } from "../src/server/turn-runs.ts";
import { createPracticeAgent } from "../src/agent/teacher-agent.ts";

test("a turn carries the learner tree in its prompt and saves what he says", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-learner-flow-"));
	const learnerStore = createLearnerStore(path.join(root, "learner.json"));
	const original = stores.learnerStore;
	stores.learnerStore = learnerStore;
	process.env.OPENROUTER_API_KEY ??= "test-presence-only";
	const chat = stores.chatStore.createChat("Oscillators", "practice");
	t.after(() => { stores.learnerStore = original; stores.chatStore.deleteChat(chat.id); fs.rmSync(root, { recursive: true, force: true }); });
	stores.chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
	learnerStore.update((state) => {
		applyWritten(state, { branchId: GENERAL_BRANCH, aspect: "skills", text: "Comfortable with calculus.", now: new Date().toISOString(), newId: () => "n_calc" });
		ensureSubject(state, "Physics", "", new Date().toISOString());
		state.chatSubjects[chat.id] = "physics";
	});

	const faux = createFauxCore({});
	let observedPrompt = "";
	faux.setResponses([
		(context) => {
			observedPrompt = JSON.stringify(context.messages.filter((m) => m.role === "system"));
			return fauxAssistantMessage([fauxToolCall("remember_how_i_learn", { action: "remember", where: "subject", subject: "Physics", aspect: "explaining", text: "Derive first, then explain in words.", quote: "derivation first" }, { id: "remember_1" })], { stopReason: "toolUse" });
		},
		() => fauxAssistantMessage([fauxText("Noted. Derivations come first from now on.")]),
	]);
	const factory: NonNullable<Parameters<typeof handleChatRequest>[1]> = (opts) => createPracticeAgent({ chatId: chat.id, chatStore: stores.chatStore }, { ...opts, engine: { model: faux.getModel(), streamFn: faux.streamSimple } });
	const response = await handleChatRequest(new Request("http://test/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: chat.id, input: { type: "text", text: "Please give me the derivation first." } }) }), factory);
	assert.equal(response.status, 200, await response.text());
	const handle = runningTurn(chat.id); if (handle) await new Response(handle.subscribe()).text();

	assert.match(observedPrompt, /# How he learns/);
	assert.match(observedPrompt, /\[n_calc\] Comfortable with calculus\./);
	assert.match(observedPrompt, /Physics \(the subject of this lesson\)/);
	const saved = learnerStore.read().notes.find((n) => n.branchId === "physics");
	assert.equal(saved?.status, "active");
	assert.equal(saved?.origin, "said");
	assert.equal(saved?.evidence[0]?.chatId, chat.id);
});
