import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { emptyLearningState, recommendGoals, dailyAllocation, learningSessionInstructions, type GoalInput, type ReviewItem, type LearningSession, type ReviewEvidence } from "../src/core/learning.ts";
import { reviewEvidence, reviewSchedules } from "../src/core/learning-review.ts";
import { createLearningStore } from "../src/store/learning.ts";
import { changeLearning, learningPayload, startLearningSession, LearningConflict, type LearningDeps } from "../src/server/learning.ts";
import type { ChatRecord } from "../src/core/contracts/chat.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { problemTool, concludeTool, createPracticeGate, type PracticeGate } from "../src/agent/tools/practice.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";

const born = "2026-10-01T00:00:00.000Z", reviewed = "2026-10-02T00:00:00.000Z", now = new Date("2026-10-03T00:00:00.000Z");
const goal: GoalInput = { title: "Oscillations", subject: "physics", outcome: "Derive the oscillator and connect its prediction to measurement.", priority: "high", status: "active", steps: [{ id: "step_one", title: "Derive the equation under explicit assumptions", done: false }] };
const item = (id = "derive"): ReviewItem => ({ id, objective: "Reconstruct the oscillator equation", subject: "physics", dimension: "derive", source: { nodeIds: [], label: "Personal objective" }, createdAt: born, paused: false });
const session = (items = [item()]): LearningSession => ({ chatId: "chat_test", kind: "review", subject: "physics", minutes: 5, startedAt: reviewed, reviewItems: items });
const record = (messages: LhMessage[] = []): ChatRecord => ({ id: "chat_test", title: "Review", kind: "practice", createdAt: born, updatedAt: reviewed, messages });
const event = (assessment: ReviewEvidence["assessment"], overrides: Partial<ReviewEvidence> = {}): ReviewEvidence => ({ itemId: "derive", chatId: "chat_test", messageId: "msg_c", callId: "call_c", at: reviewed, assessment, reason: "Observed reasoning", problem: "Derive the equation", ...overrides });
function call(name: string, args: Record<string, unknown>, id: string, acknowledged = true, isError = false): LhMessage[] {
	const assistant = { ...fauxAssistantMessage([fauxToolCall(name, args as Parameters<typeof fauxToolCall>[1], { id })], { stopReason: "toolUse" }), id: `msg_${id}`, timestamp: Date.parse(reviewed) } as LhMessage;
	return [assistant, ...(acknowledged ? [{ id: `ack_${id}`, role: "toolResult", toolName: name, toolCallId: id, content: [{ type: "text", text: "ok" }], details: null, isError, timestamp: Date.parse(reviewed) + 1 } as LhMessage] : [])];
}
const pose = { statement: "Derive the oscillator equation and state its assumptions.", mode: "recall" as const, modelSolution: "Linear restoring force, no damping; Newton's law gives the equation.", reviewTargets: ["derive"] };
const conclusion = { outcome: "solvedWithHints" as const, verdict: "The derivation needed help.", rung: "R2" as const, missClass: "structural" as const, retest: false, reviewAssessments: [{ itemId: "derive", assessment: "supported" as const, reason: "Needed the force balance before completing the derivation." }] };
function fixture(t: { after(fn: () => void): void }) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-learning-test-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const file = path.join(root, "learning.json"), learningStore = createLearningStore(file), chats = new Map<string, ChatRecord>();
	const deps: LearningDeps = { learningStore, graphStore: { readNodes: () => [] }, chatStore: {
		getChat: id => chats.get(id) ?? null, listChats: () => [], deleteChat: id => chats.delete(id),
		createChat: (title, kind) => { const chat: ChatRecord = { ...record(), id: `chat_${chats.size}`, title, kind }; chats.set(chat.id, chat); return chat; },
		saveSettings: (id, settings) => { chats.get(id)!.settings = settings; },
	} };
	return { file, deps, chats, learningStore };
}

test("reading empty records is inert; invalid/newer data is never overwritten", t => {
	const { file, learningStore } = fixture(t);
	assert.deepEqual(learningStore.read(), emptyLearningState()); assert.equal(fs.existsSync(file), false);
	for (const bad of ['{"version":2}', '{"unfinished":', JSON.stringify({ ...emptyLearningState(), goals: [{ ...goal, id: "bad", createdAt: born, updatedAt: born, steps: [{ id: "same", title: "a", done: false }, { id: "same", title: "b", done: false }] }] })]) {
		fs.writeFileSync(file, bad); assert.throws(() => learningStore.update(s => { s.dailyMinutes = 45; })); assert.equal(fs.readFileSync(file, "utf8"), bad);
	}
});
test("goals and started lessons do not enroll review; stale edits and failed updates preserve records", t => {
	const { deps, learningStore, file } = fixture(t);
	const saved = changeLearning({ action: "saveGoal", revision: 0, goal }, deps, new Date(born));
	assert.equal(saved.reviewItems.length, 0); assert.equal(saved.revision, 1);
	const before = fs.readFileSync(file, "utf8");
	assert.throws(() => changeLearning({ action: "preferences", revision: 0, dailyMinutes: 40 }, deps), LearningConflict);
	assert.throws(() => learningStore.update(s => { s.dailyMinutes = -1; })); assert.equal(fs.readFileSync(file, "utf8"), before);
	const started = startLearningSession({ kind: "goal", goalId: saved.goals[0]!.id, minutes: 25, revision: 1 }, deps, now);
	assert.equal(learningStore.read().sessions[started.id]?.stepId, "step_one");
	assert.equal(learningPayload(deps, now).reviews.length, 0);
	assert.equal(learningPayload(deps, now).recommendations[0]?.resumeChatId, undefined, "a blank session is not learning activity");
});
test("only explicit enrollment creates new, untested objectives; removal and re-enrollment do not inherit grades", t => {
	const { deps } = fixture(t);
	const { id: _id, createdAt: _created, paused: _paused, ...input } = item();
	let state = changeLearning({ action: "enroll", revision: 0, items: [input, input] }, deps, new Date(born));
	assert.equal(state.reviewItems.length, 1); const firstId = state.reviewItems[0]!.id;
	assert.equal(learningPayload(deps, now).reviews[0]?.state, "untested");
	state = changeLearning({ action: "pauseReview", revision: state.revision, id: firstId, paused: true }, deps);
	assert.equal(learningPayload(deps, now).reviews[0]?.state, "paused");
	assert.throws(() => startLearningSession({ kind: "review", itemIds: [firstId], minutes: 5, revision: state.revision }, deps), /active review/);
	state = changeLearning({ action: "removeReview", revision: state.revision, id: firstId }, deps);
	state = changeLearning({ action: "enroll", revision: state.revision, items: [input] }, deps, now);
	assert.notEqual(state.reviewItems[0]!.id, firstId); assert.equal(learningPayload(deps, now).reviews[0]?.state, "untested");
});
test("invalid sources do not partially enroll; mixed goal/review starts cannot create records", t => {
	const { deps, learningStore, chats } = fixture(t);
	const { id: _id, createdAt: _created, paused: _paused, ...input } = item();
	assert.throws(() => changeLearning({ action: "enroll", revision: 0, items: [input, { ...input, source: { chatId: "missing", nodeIds: [], label: "" } }] }, deps), /unavailable/);
	assert.equal(learningStore.read().reviewItems.length, 0);
	assert.throws(() => startLearningSession({ kind: "goal", goalId: "missing", itemIds: ["derive"], minutes: 5, revision: 0 }, deps), /cannot also/);
	assert.equal(chats.size, 0);
});
test("review context snapshots explicit selections and retains the main subject budget", t => {
	const { deps, learningStore } = fixture(t);
	learningStore.update(s => { s.reviewItems = [item()]; s.goals = [{ ...goal, id: "goal_one", createdAt: born, updatedAt: born }]; });
	const created = startLearningSession({ kind: "review", itemIds: ["derive"], nextGoalId: "goal_one", nextGoalMinutes: 25, minutes: 5, revision: 1 }, deps, now);
	const context = learningStore.read().sessions[created.id]!;
	assert.equal(context.nextGoalMinutes, 25); assert.equal(context.reviewItems.length, 1); assert.equal(context.kind, "review");
	assert.match(learningSessionInstructions(context), /assumptions → derivation → result → observable predictions → validity limits/);
	assert.deepEqual(dailyAllocation(30, 2), { reviewMinutes: 5, mainMinutes: 25 });
	assert.deepEqual(dailyAllocation(30, 0), { reviewMinutes: 0, mainMinutes: 30 });
});
test("evidence requires clean acknowledged pose/conclude pairs and separates capabilities", () => {
	const messages = [...call("problem", { ...pose, reviewTargets: ["derive", "assumptions"] }, "p"), ...call("conclude", { ...conclusion, reviewAssessments: [conclusion.reviewAssessments[0], { itemId: "assumptions", assessment: "independent", reason: "Named and justified the approximation unaided." }, { itemId: "unknown", assessment: "independent", reason: "Not selected" }] }, "c")];
	const evidence = reviewEvidence(record(messages), session([item(), { ...item("assumptions"), dimension: "assumptions" }]));
	assert.deepEqual(evidence.map(e => [e.itemId, e.assessment]), [["derive", "supported"], ["assumptions", "independent"]]);
	assert.equal(evidence[0]?.problem, pose.statement);
	assert.equal(reviewEvidence({ ...record(messages), kind: undefined }, session()).length, 0);
	for (const [acknowledged, isError] of [[false, false], [true, true]]) {
		assert.equal(reviewEvidence(record([...call("problem", pose, "p", acknowledged, isError), ...call("conclude", conclusion, "c")]), session()).length, 0);
		assert.equal(reviewEvidence(record([...call("problem", pose, "p"), ...call("conclude", conclusion, "c", acknowledged, isError)]), session()).length, 0);
	}
	assert.equal(reviewEvidence(record([...messages, ...messages]), session()).length, 1, "duplicate calls do not produce duplicate evidence");
});
test("skips, dismissed problems, missing target assessments and old practice do not invent grades", () => {
	for (const outcome of ["movedOn", "dismissed"]) assert.equal(reviewEvidence(record([...call("problem", pose, "p"), ...call("conclude", { ...conclusion, outcome }, "c")]), session()).length, 0);
	assert.equal(reviewEvidence(record([...call("problem", { ...pose, reviewTargets: undefined }, "p"), ...call("conclude", conclusion, "c")]), session()).length, 0);
	assert.equal(reviewEvidence(record([...call("problem", pose, "p"), ...call("conclude", { ...conclusion, reviewAssessments: [] }, "c")]), session()).length, 0);
});
test("FSRS Hard brings supported success back sooner than independent Good", () => {
	const due = (assessment: ReviewEvidence["assessment"]) => reviewSchedules([item()], [event(assessment)], now)[0]!;
	assert.ok(due("supported").dueAt < due("independent").dueAt);
	assert.ok(due("unsuccessful").dueAt <= due("supported").dueAt);
	assert.equal(due("unassessed").state, "untested");
	assert.equal(reviewSchedules([item()], [event("independent", { at: "2026-09-30T00:00:00.000Z" })], now)[0]?.state, "untested");
});
test("same-session retests stay visible without inflating intervals; deleted evidence is replayed away", () => {
	const failure = event("unsuccessful"), correction = event("independent", { callId: "retest", at: "2026-10-02T00:30:00.000Z" });
	const first = reviewSchedules([item()], [failure], now)[0]!, repeated = reviewSchedules([item()], [failure, correction], now)[0]!;
	assert.equal(repeated.dueAt, first.dueAt); assert.equal(repeated.evidence.length, 2);
	assert.equal(reviewSchedules([item()], [], now)[0]?.state, "untested");
	assert.notEqual(reviewSchedules([item()], [failure, { ...correction, chatId: "new_sitting" }], now)[0]?.dueAt, first.dueAt);
});
test("recommendations use active priority, genuine recency, unfinished steps and specific gaps", () => {
	const state = emptyLearningState();
	state.goals = ["older", "recent", "low", "paused", "done"].map(id => ({ ...goal, id, priority: id === "low" ? "low" : "high", status: id === "paused" ? "paused" : "active", steps: goal.steps.map(s => ({ ...s, done: id === "done" })), createdAt: born, updatedAt: born }));
	state.sessions = { c: { ...session(), chatId: "c", kind: "goal", goalId: "recent", stepId: "step_one" } };
	const reviews = reviewSchedules([{ ...item(), goalId: "older" }], [event("unsuccessful")], now);
	const recommendations = recommendGoals(state, new Map([["c", reviewed]]), reviews);
	assert.deepEqual(recommendations.map(r => r.goal.id), ["older", "recent", "low"]);
	assert.equal(recommendations[0]?.repairItem?.id, "derive"); assert.equal(recommendations[1]?.resumeChatId, "c");
});
test("tool gates require selected targets and independent per-target judgments, including across turns", async () => {
	const gate: PracticeGate = { problemActive: false }, tool = problemTool(gate, undefined, [item(), item("assumptions")]);
	assert.equal((await tool.execute("bad", { ...pose, reviewTargets: ["unknown"] })).isError, true);
	assert.equal((await tool.execute("p", { ...pose, reviewTargets: ["derive", "assumptions"] })).isError, undefined);
	const conclude = concludeTool(gate);
	assert.equal((await conclude.execute("c", conclusion)).isError, true, "cannot blanket-grade only one of two targets");
	const all = { ...conclusion, reviewAssessments: [...conclusion.reviewAssessments, { itemId: "assumptions", assessment: "unassessed" as const, reason: "Not established in the response" }] };
	assert.notEqual((await conclude.execute("c", all)).isError, true); assert.equal(gate.problemActive, false);
	const restored = createPracticeGate({ chatId: "chat_test", chatStore: { getChat: () => record(call("problem", pose, "p")) } });
	assert.deepEqual(restored.reviewTargets, ["derive"]);
	assert.equal((await concludeTool(restored).execute("c", { ...conclusion, reviewAssessments: undefined })).isError, true);
});
test("subject reasoning reaches all conversation roles and preserves systems and general learning", () => {
	for (const kind of ["prober", "teacher", "practice"] as const) {
		const prompt = composeInstructions(kind);
		assert.match(prompt, /observable predictions → limitations/); assert.match(prompt, /coding exercises are not the default/); assert.match(prompt, /Other interests/);
	}
	assert.doesNotMatch(composeInstructions("teacher"), /Default to saying \*\*"unconditional truth"/);
});
