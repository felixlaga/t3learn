/**
 * THE LESSON REDESIGN (owner, 2026-10-30): eight question formats picked
 * per question, and a chat box that never answers. A message sent while a
 * question is open leaves it waiting; his later answer or skip arrives as
 * its own message. Pure core + the tool seam; no data dir.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildAnswer,
	compactAnswerForModel,
	dismissAppends,
	dismissedAnswer,
	displayOptions,
	explainInputProblems,
	findPendingToolCall,
	inputAppends,
	learnerTextOf,
	learningProgress,
	newMessageId,
	normalizeExplainFormat,
	normalizeQuizFormat,
	openQuestionOf,
	projectView,
	quizInputProblems,
	renderForReader,
	toLlmMessages,
	waitingQuestionOf,
	WAITING_NOTE,
	type LhMessage,
	type QuestionData,
} from "../src/core/index.ts";
import { createTeacherTools, guardOpenQuestion, probeQuizTool, teachExplainToolFor } from "../src/agent/tools.ts";

const opts = (...labels: string[]) => labels.map((label, i) => ({ label, value: `v${i + 1}` }));

describe("question formats: authoring contract", () => {
	it("defaults: absent or unknown format means today's shapes", () => {
		assert.equal(normalizeQuizFormat(undefined), "choice");
		assert.equal(normalizeQuizFormat("nonsense"), "choice");
		assert.equal(normalizeQuizFormat('"order"'), "order", "model quote debris heals");
		assert.equal(normalizeExplainFormat(undefined), "short");
		assert.equal(normalizeExplainFormat("next_line"), "next_line");
	});

	it("true_false: the tool fills True and False, and a boolean answer becomes its value", () => {
		const prepared = probeQuizTool.prepareArguments!({ format: "true_false", question: "Light bends near mass.", explanation: "GR.", correctAnswer: true }) as Record<string, unknown>;
		assert.deepEqual(prepared.options, [{ label: "True", value: "true" }, { label: "False", value: "false" }]);
		assert.equal(prepared.correctAnswer, "true");
		assert.deepEqual(quizInputProblems(prepared as never), []);
		assert.ok(quizInputProblems({ format: "true_false", options: opts("Yes", "No"), correctAnswer: "v1" }).some((p) => p.includes("true_false")));
	});

	it("spot_error: at least 3 lines and exactly one wrong", () => {
		assert.deepEqual(quizInputProblems({ format: "spot_error", options: opts("a", "b", "c"), correctAnswer: "v2" }), []);
		assert.ok(quizInputProblems({ format: "spot_error", options: opts("a", "b"), correctAnswer: "v2" }).length > 0);
		assert.ok(quizInputProblems({ format: "spot_error", options: opts("a", "b", "c"), correctAnswer: ["v1", "v2"], multiSelect: true }).length > 0);
	});

	it("order: correctAnswer lists every step exactly once", () => {
		assert.deepEqual(quizInputProblems({ format: "order", options: opts("a", "b", "c"), correctAnswer: ["v2", "v1", "v3"] }), []);
		assert.ok(quizInputProblems({ format: "order", options: opts("a", "b", "c"), correctAnswer: ["v2", "v1"] }).length > 0, "a missing step is refused");
		assert.ok(quizInputProblems({ format: "order", options: opts("a", "b", "c"), correctAnswer: "v2" }).length > 0, "a single value is refused");
	});

	it("next_line needs the derivation so far", () => {
		assert.ok(explainInputProblems({ format: "next_line", correctAnswer: "x = 1" }).length > 0);
		assert.deepEqual(explainInputProblems({ format: "next_line", lines: ["x + 1 = 2"], correctAnswer: "x = 1" }), []);
		assert.deepEqual(explainInputProblems({ format: "formula", correctAnswer: "c/H(z)" }), []);
	});
});

describe("question formats: display and grading", () => {
	it("display order: true/false fixed, spot_error kept, order never shown solved", () => {
		const tf = displayOptions("true_false", [{ label: "False", value: "false" }, { label: "True", value: "true" }], "seed");
		assert.deepEqual(tf.map((o) => o.value), ["true", "false"]);
		const lines = opts("a", "b", "c", "d");
		assert.deepEqual(displayOptions("spot_error", lines, "seed"), lines);
		for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]) {
			const shown = displayOptions("order", lines, seed);
			assert.notDeepEqual(shown.map((o) => o.value), ["v1", "v2", "v3", "v4"], `seed ${seed} shows the solved order`);
			assert.deepEqual(displayOptions("order", lines, seed), shown, "same seed, same order");
		}
	});

	it("order is graded as the whole sequence, and the model reads his order", () => {
		const qd: QuestionData = {
			id: "q", kind: "quiz", format: "order", question: "Order it.", mode: "single-select",
			options: [{ label: "B", value: "b" }, { label: "A", value: "a" }, { label: "C", value: "c" }],
			correctOrder: ["a", "b", "c"], correctIndices: [], createdAt: "",
		};
		const right = buildAnswer(qd, { order: ["a", "b", "c"], confidence: 70 });
		assert.equal(right.correct, true);
		assert.deepEqual(right.order, ["A", "B", "C"]);
		const wrong = buildAnswer(qd, { order: ["b", "a", "c"], confidence: 70 });
		assert.equal(wrong.correct, false);
		assert.deepEqual(wrong.correctOrder, ["A", "B", "C"]);
		assert.deepEqual(compactAnswerForModel(wrong).order, ["B", "A", "C"]);
		assert.equal(buildAnswer(qd, { dontKnow: true }).correct, false);
	});

	it("typed answers carry confidence and the derivation they continued", () => {
		const qd: QuestionData = {
			id: "q", kind: "explain", format: "next_line", question: "Next line?", mode: "text",
			lines: ["c\\,dt = a\\,d\\chi"], options: [], committedAnswer: "d\\chi = c\\,dt/a", createdAt: "",
		};
		const answer = buildAnswer(qd, { text: "d\\chi = c\\,dt/a", thinking: "divide by a", confidence: 90 });
		assert.equal(answer.confidence, 90);
		assert.equal(answer.format, "next_line");
		assert.deepEqual(answer.lines, ["c\\,dt = a\\,d\\chi"]);
		assert.equal(compactAnswerForModel(answer).confidence, 90);
	});
});

// ─── chat while a question is open ──────────────────────────────────────────

function recordWithOpenQuiz(): LhMessage[] {
	return [
		{ id: newMessageId(), role: "user", content: "Teach me lensing.", timestamp: 1 } as LhMessage,
		{
			id: newMessageId(),
			role: "assistant",
			content: [
				{ type: "text", text: "Here is the idea." },
				{ type: "toolCall", id: "call_q1", name: "quiz", arguments: { type: "check", nodeId: "n1", question: "Which universe?", options: opts("A", "B"), explanation: "Because.", correctAnswer: "v1" } },
			],
			timestamp: 2,
		} as unknown as LhMessage,
	];
}

const answerFor = (correct: boolean) => ({
	kind: "quiz" as const, tool: "quiz", questionText: "Which universe?", dontKnow: false,
	answers: [{ label: correct ? "A" : "B", value: correct ? "v1" : "v2", index: correct ? 1 : 2 }],
	correct, confidence: 70, thinking: "H(z) was larger in B", answeredAt: new Date().toISOString(),
});

describe("the chat box never answers: waiting questions", () => {
	it("a chat message parks the open question, adjacent to its call", () => {
		const record = { messages: recordWithOpenQuiz() };
		const appends = inputAppends(record, { type: "text", text: "Can you explain H(z) again?" });
		assert.equal(appends.length, 2);
		assert.equal(appends[0]!.role, "toolResult");
		assert.equal((appends[0] as { toolCallId: string }).toolCallId, "call_q1");
		assert.equal(((appends[0] as { details: { waiting?: boolean } }).details).waiting, true);
		assert.equal(appends[1]!.role, "user");
		const after = [...record.messages, ...appends.map((m, i) => ({ ...m, id: m.id ?? `x${i}` }))];
		assert.equal(waitingQuestionOf(after)?.toolCallId, "call_q1");
		assert.equal(openQuestionOf(after)?.toolCallId, "call_q1", "still open on his screen");
		const wire = JSON.stringify(toLlmMessages(after as never));
		assert.ok(wire.includes("He has not answered yet"), "the model reads the waiting note");
		assert.ok(WAITING_NOTE.includes("Ask no new question"));
	});

	it("a later answer arrives as its own message and closes the question", () => {
		const record = { messages: recordWithOpenQuiz() };
		const parked = [...record.messages, ...inputAppends(record, { type: "text", text: "Wait, what is H(z)?" })];
		const teacher = { id: newMessageId(), role: "assistant", content: [{ type: "text", text: "H(z) is the expansion rate." }], timestamp: 5 } as unknown as LhMessage;
		const withReply = [...parked, teacher];
		assert.equal(openQuestionOf(withReply)?.toolCallId, "call_q1", "the reply does not close it");
		const late = inputAppends({ messages: withReply }, { type: "answer", toolCallId: "call_q1", answer: answerFor(true) });
		assert.equal(late.length, 1);
		assert.equal(late[0]!.role, "custom");
		assert.equal((late[0] as { customType: string }).customType, "late-answer");
		const done = [...withReply, ...late];
		assert.equal(openQuestionOf(done), null);
		const wire = JSON.stringify(toLlmMessages(done as never));
		assert.ok(wire.includes("His answer to the question that was waiting"), "the model reads the late answer");
		assert.throws(() => inputAppends({ messages: done }, { type: "answer", toolCallId: "call_q1", answer: answerFor(true) }), /no pending question/);
	});

	it("a skip of a waiting question is a late dismissal", () => {
		const record = { messages: recordWithOpenQuiz() };
		const parked = [...record.messages, ...inputAppends(record, { type: "text", text: "hmm" })];
		const appends = dismissAppends({ messages: parked }, { type: "dismiss", toolCallId: "call_q1", answer: dismissedAnswer("quiz", "Which universe?") });
		assert.equal((appends[0] as { customType: string }).customType, "late-answer");
		assert.ok((appends[0] as { content: string }).content.startsWith("He skipped"));
		assert.equal(openQuestionOf([...parked, ...appends]), null);
	});

	it("the screen keeps a waiting question open and shows the late answer as a card", () => {
		const record = { messages: recordWithOpenQuiz() };
		const parked = [...record.messages, ...inputAppends(record, { type: "text", text: "Explain more?" })];
		const pending = findPendingToolCall(projectView(parked) as never);
		assert.equal(pending?.toolCallId, "call_q1");
		assert.equal(pending?.waiting, true);
		const done = [...parked, ...inputAppends({ messages: parked }, { type: "answer", toolCallId: "call_q1", answer: answerFor(false) })];
		const view = projectView(done);
		assert.equal(findPendingToolCall(view as never), null);
		assert.ok(view.some((m) => m.parts.some((p) => p.type === "data-late-answer")), "the late answer renders as a card");
	});

	it("progress and the tree's reader count the late answer, not the placeholder", () => {
		const record = { messages: recordWithOpenQuiz() };
		const parked = [...record.messages, ...inputAppends(record, { type: "text", text: "Explain more?" })];
		const done = [...parked, ...inputAppends({ messages: parked }, { type: "answer", toolCallId: "call_q1", answer: answerFor(true) })];
		const progress = learningProgress([{ id: "c1", kind: undefined, messages: done } as never], { ideas: 0, connections: 0 }, Date.now() + 1000, "UTC");
		const answered = progress.badges.find((b) => b.id === "first")!;
		assert.equal(answered.value, 1, "one answer, counted once");
		const read = renderForReader(done, undefined);
		assert.ok(read.text.includes("it waited while he chatted"));
		assert.ok(!read.text.includes("answered quiz:\n{\"kind\":\"quiz\",\"waiting\""), "the placeholder is not an answer");
		assert.ok(learnerTextOf(done).texts.includes("H(z) was larger in B"), "his thinking can be quoted");
	});
});

describe("one question at a time, even while he chats", () => {
	it("every question tool refuses while a question waits", async () => {
		const record = { messages: recordWithOpenQuiz() };
		const parked = [...record.messages, ...inputAppends(record, { type: "text", text: "Explain more?" })];
		const ctx = { chatId: "c1", chatStore: { getChat: () => ({ messages: parked }) } };
		const guarded = guardOpenQuestion(teachExplainToolFor(ctx as never), ctx as never);
		const result = await guarded.execute("call_new", { type: "check", nodeId: "n1", question: "Q?", correctAnswer: "A." } as never);
		assert.equal(result.isError, true);
		assert.match(JSON.stringify(result.content), /still open on his screen/);
		const tools = createTeacherTools({ ...ctx, jobStore: {} as never, spawn: () => {} } as never);
		const ask = await tools.ask_user_question!.execute("call_ask", { question: "Next?" } as never);
		assert.equal(ask.isError, true, "ask_user_question waits too");
	});

	it("with nothing open, the guard passes the call through", async () => {
		const ctx = { chatId: "c1", chatStore: { getChat: () => ({ messages: [] }) } };
		const guarded = guardOpenQuestion(probeQuizTool, ctx as never);
		const result = await guarded.execute("call_ok", { question: "Q?", options: opts("a", "b"), explanation: "e", correctAnswer: "v1" } as never);
		assert.notEqual(result.isError, true);
		assert.equal(result.terminate, true);
	});
});
