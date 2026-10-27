import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, fauxText } from "@earendil-works/pi-ai";
import { stores } from "../src/server/stores.ts";
import { createLearningStore } from "../src/store/learning.ts";
import { startLearningSession, learningPayload } from "../src/server/learning.ts";
import { handleChatRequest } from "../src/server/chat-handler.ts";
import { runningTurn } from "../src/server/turn-runs.ts";
import { createPracticeAgent } from "../src/agent/teacher-agent.ts";

test("a daily review survives pose → reload → hinted answer → persisted per-objective schedules", async t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-daily-flow-"));
	const learningStore = createLearningStore(path.join(root, "learning.json"));
	const original = stores.learningStore;
	stores.learningStore = learningStore;
	process.env.OPENROUTER_API_KEY ??= "test-presence-only";
	t.after(() => { stores.learningStore = original; fs.rmSync(root, { recursive: true, force: true }); });
	const born = new Date(Date.now() - 86400000).toISOString();
	learningStore.update(s => { s.reviewItems = [
		{ id: "derive", objective: "Derive the oscillator equation", dimension: "derive", subject: "physics", source: { nodeIds: [], label: "Manual" }, paused: false, createdAt: born },
		{ id: "limits", objective: "Explain the small-displacement limit", dimension: "limitations", subject: "physics", source: { nodeIds: [], label: "Manual" }, paused: false, createdAt: born },
	]; });
	const started = startLearningSession({ kind: "review", itemIds: ["derive", "limits"], minutes: 5, revision: 1 });
	t.after(() => stores.chatStore.deleteChat(started.id));
	stores.chatStore.saveSettings(started.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
	const faux = createFauxCore({});
	let observedPrompt = "";
	faux.setResponses([
		context => { observedPrompt = JSON.stringify(context.messages.filter(m => m.role === "system")); return fauxAssistantMessage([fauxToolCall("problem", { statement: "Derive the linear oscillator equation and explain the limit of this model.", mode: "composition", modelSolution: "Using F = -kx and F = ma gives x'' + (k/m)x = 0; large displacements require nonlinear corrections.", reviewTargets: ["derive", "limits"] }, { id: "daily_pose" })], { stopReason: "toolUse" }); },
		() => fauxAssistantMessage([fauxToolCall("conclude", { outcome: "solvedWithHints", verdict: "Derivation with help; validity limit explained independently.", rung: "R2", missClass: "structural", retest: false, reviewAssessments: [
			{ itemId: "derive", assessment: "supported", reason: "Needed a force-balance hint, then completed the algebra." },
			{ itemId: "limits", assessment: "independent", reason: "Explained the nonlinear correction without help." },
		] }, { id: "daily_conclude" })], { stopReason: "toolUse" }),
		() => fauxAssistantMessage([fauxText("That completes this short review. Return to Today for your main subject.")]),
	]);
	const factory: NonNullable<Parameters<typeof handleChatRequest>[1]> = opts => createPracticeAgent({ chatId: started.id, chatStore: stores.chatStore, reviewItems: learningStore.read().sessions[started.id]!.reviewItems }, { ...opts, engine: { model: faux.getModel(), streamFn: faux.streamSimple } });
	async function turn(input: unknown) {
		const response = await handleChatRequest(new Request("http://test/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: started.id, input }) }), factory);
		assert.equal(response.status, 200, await response.text());
		const handle = runningTurn(started.id); if (handle) await new Response(handle.subscribe()).text();
	}
	await turn({ type: "text", text: "Start my selected review." });
	assert.match(observedPrompt, /Selected objectives/); assert.match(observedPrompt, /observable predictions/);
	assert.equal(learningPayload().reviews.every(r => r.state === "untested"), true, "posing does not grade");
	await turn({ type: "thinking", problemCallId: "daily_pose", text: "With the force-balance hint I obtain x'' + kx/m = 0. For large displacements the neglected nonlinear restoring terms matter." });
	const reviews = learningPayload().reviews;
	const derive = reviews.find(r => r.item.id === "derive")!, limits = reviews.find(r => r.item.id === "limits")!;
	assert.equal(derive.evidence[0]?.assessment, "supported"); assert.equal(limits.evidence[0]?.assessment, "independent");
	assert.ok(derive.dueAt < limits.dueAt, "Hard returns sooner than Good for the separately assessed capabilities");
	assert.equal(derive.evidence[0]?.callId, "daily_conclude");
	assert.equal(learningStore.read().reviewItems.length, 2, "the turn enrolled nothing else");
	assert.deepEqual(learningPayload().reviews, reviews, "reloading replays the same persisted evidence");
});
