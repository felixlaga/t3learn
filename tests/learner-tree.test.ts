/**
 * THE LEARNER TREE (owner, 2026-10-30): the rules for how notes about how
 * he learns come into use, the "How he learns" prompt section, the live
 * tool, the background reader and the store. Pacium's learning-store
 * rules, adapted: what he says is used at once; what is noticed is used
 * after a second sighting; what he writes stays his; what he forgets
 * stays forgotten.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";
import {
	applyForget,
	applyNoticed,
	applySaid,
	applyWritten,
	emptyLearnerState,
	ensureSubject,
	GENERAL_BRANCH,
	learnerBrief,
	learnerInputsAfter,
	learnerTextOf,
	quoteFound,
	renderForReader,
	type LearnerState,
	type LearnerStore,
} from "../src/core/learner.ts";
import { newAnswerResult, newUserMessage, type LhMessage } from "../src/core/native-messages.ts";
import { learnerTools, REMEMBER_TOOL } from "../src/agent/tools/learner.ts";
import { createLearnerReader } from "../src/agent/subagents/learner-reader.ts";
import { createLearnerStore } from "../src/store/learner.ts";
import { allowedLearningFile } from "../src/core/backup.ts";
import type { PiEngine } from "../src/agent/models.ts";

const NOW = "2026-10-30T10:00:00.000Z";
let counter = 0;
const newId = () => `n${++counter}`;

function memoryStore(initial: LearnerState = emptyLearnerState()): LearnerStore & { state: LearnerState } {
	const box = { state: structuredClone(initial) };
	return {
		get state() { return box.state; },
		read: () => structuredClone(box.state),
		update(change) {
			const draft = structuredClone(box.state);
			const result = change(draft);
			draft.revision++;
			box.state = draft;
			return { state: structuredClone(draft), result };
		},
	};
}

function withPhysics(): LearnerState {
	const state = emptyLearnerState();
	ensureSubject(state, "Physics", "Mechanics and cosmology", NOW);
	return state;
}

describe("the learner tree rules", () => {
	it("uses what he says at once", () => {
		const state = withPhysics();
		const r = applySaid(state, { branchId: "physics", aspect: "explaining", text: "Show the derivation before the intuition.", quote: "derivation first please", messageIds: ["m1"], now: NOW, newId });
		assert.equal(r.status, "active");
		assert.equal(state.notes[0]!.origin, "said");
	});

	it("waits for a second sighting before using what it noticed", () => {
		const state = withPhysics();
		const first = applyNoticed(state, { branchId: "physics", aspect: "questions", text: "Give the numbers explicitly.", messageIds: ["m1"], now: NOW, newId });
		assert.equal(first.status, "observed");
		const same = applyNoticed(state, { branchId: "physics", aspect: "questions", text: "Give the numbers explicitly.", supports: first.noteId, messageIds: ["m1"], now: NOW, newId });
		assert.equal(same.status, "observed", "the same message never corroborates itself");
		const second = applyNoticed(state, { branchId: "physics", aspect: "questions", text: "Give the numbers explicitly.", supports: first.noteId, messageIds: ["m7"], now: NOW, newId });
		assert.equal(second.status, "active");
		assert.equal(state.notes.length, 1);
	});

	it("uses a pattern seen in two of his messages at once", () => {
		const state = withPhysics();
		assert.equal(applyNoticed(state, { branchId: GENERAL_BRANCH, aspect: "struggles", text: "Loses track of signs in long algebra.", messageIds: ["m2", "m5"], now: NOW, newId }).status, "active");
	});

	it("never revives a forgotten note", () => {
		const state = withPhysics();
		const said = applySaid(state, { branchId: GENERAL_BRANCH, aspect: "background", text: "Studied engineering.", quote: "I studied engineering", messageIds: ["m1"], now: NOW, newId });
		assert.equal(applyForget(state, { noteId: said.noteId!, messageIds: [], now: NOW }).status, "forgotten");
		assert.equal(applyNoticed(state, { branchId: GENERAL_BRANCH, aspect: "background", text: "Studied engineering.", supports: said.noteId, messageIds: ["m3", "m4"], now: NOW, newId }).status, "ignored");
		assert.equal(applyNoticed(state, { branchId: GENERAL_BRANCH, aspect: "background", text: "studied   engineering", messageIds: ["m3", "m4"], now: NOW, newId }).status, "ignored");
		assert.equal(state.notes.filter((n) => n.status !== "retired").length, 0);
	});

	it("keeps what he said or wrote his own", () => {
		const state = withPhysics();
		const written = applyWritten(state, { branchId: "physics", aspect: "explaining", text: "Use pictures.", now: NOW, newId });
		const r = applyNoticed(state, { branchId: "physics", aspect: "explaining", text: "Avoid pictures.", supports: written.noteId, messageIds: ["m1", "m2"], now: NOW, newId });
		assert.equal(r.status, "unchanged");
		assert.equal(state.notes[0]!.text, "Use pictures.");
		assert.equal(state.notes[0]!.origin, "written");
	});

	it("replaces a note when he says so", () => {
		const state = withPhysics();
		const old = applySaid(state, { branchId: "physics", aspect: "questions", text: "Use multiple choice.", quote: "multiple choice", messageIds: ["m1"], now: NOW, newId });
		const fresh = applySaid(state, { branchId: "physics", aspect: "questions", text: "Ask for free derivations.", quote: "let me derive it", messageIds: ["m2"], replaces: old.noteId, now: NOW, newId });
		const retired = state.notes.find((n) => n.id === old.noteId)!;
		assert.equal(retired.status, "retired");
		assert.equal(retired.replacedBy, fresh.noteId);
	});

	it("refuses a note in the wrong place", () => {
		const state = withPhysics();
		assert.throws(() => applySaid(state, { branchId: GENERAL_BRANCH, aspect: "questions", text: "x", quote: "xyz", messageIds: [], now: NOW, newId }), /General notes are about/);
		assert.throws(() => applySaid(state, { branchId: "chemistry", aspect: "questions", text: "x", quote: "xyz", messageIds: [], now: NOW, newId }), /not in the tree/);
	});
});

describe("the How he learns section", () => {
	it("shows only notes in use, with the lesson's subject first", () => {
		const state = withPhysics();
		ensureSubject(state, "Philosophy", "", NOW);
		applySaid(state, { branchId: "physics", aspect: "explaining", text: "Derivation first.", quote: "derivation first", messageIds: ["m1"], now: NOW, newId });
		applyNoticed(state, { branchId: "physics", aspect: "questions", text: "A note seen once.", messageIds: ["m2"], now: NOW, newId });
		applySaid(state, { branchId: "philosophy", aspect: "explaining", text: "Argue in prose.", quote: "prose please", messageIds: ["m3"], now: NOW, newId });
		state.chatSubjects.chat_a = "physics";
		const brief = learnerBrief(state, "chat_a");
		assert.match(brief, /^# How he learns/);
		assert.match(brief, /## Physics \(the subject of this lesson\)/);
		assert.match(brief, /Derivation first\./);
		assert.doesNotMatch(brief, /A note seen once/);
		assert.doesNotMatch(brief, /Argue in prose/, "another subject's notes stay out once the lesson's subject is known");
		assert.match(brief, /Subjects in his tree: Physics, Philosophy/);
		assert.match(brief, /## General\nNo notes yet\./);
	});

	it("lists every subject when the lesson's subject is not known yet", () => {
		const state = withPhysics();
		applySaid(state, { branchId: "physics", aspect: "explaining", text: "Derivation first.", quote: "derivation first", messageIds: ["m1"], now: NOW, newId });
		const brief = learnerBrief(state, "chat_new");
		assert.match(brief, /## Physics \(use only if this lesson is about Physics\)/);
	});

	it("is written without dashes, like every prompt", () => {
		assert.doesNotMatch(learnerBrief(withPhysics(), undefined), /—|–/);
	});
});

describe("his own words", () => {
	it("matches a quote regardless of case, spacing and punctuation", () => {
		assert.equal(quoteFound("Derivation  FIRST", ["I want the derivation first, please."]), true);
		assert.equal(quoteFound("ok", ["ok"]), false, "too short to count");
		assert.equal(quoteFound("pictures", ["derive it"]), false);
	});

	it("reads typed text and free-text answer parts, never picked option labels", () => {
		const answer = newAnswerResult("call_1", "quiz", { kind: "quiz", questionText: "Q?", dontKnow: false, answers: [{ label: "Option label", value: "a", index: 1 }], thinking: "the question was unclear", answeredAt: NOW, correct: false, confidence: 80 });
		const typed = newUserMessage("show me the derivation first");
		const { texts, messageIds } = learnerTextOf([answer, typed]);
		assert.deepEqual(texts, ["the question was unclear", "show me the derivation first"]);
		assert.deepEqual(messageIds, [answer.id, typed.id]);
	});

	it("counts his inputs after the reader's cursor", () => {
		const a = newUserMessage("one"), b = newUserMessage("two"), c = newUserMessage("three");
		assert.equal(learnerInputsAfter([a, b, c], undefined), 3);
		assert.equal(learnerInputsAfter([a, b, c], a.id), 2);
	});
});

describe("the remember_how_i_learn tool", () => {
	function tool(store: LearnerStore, texts: string[]) {
		return learnerTools({ chatId: "chat_a", learnerInput: { texts, messageIds: texts.length ? ["m1"] : [] }, learnerStore: store, now: () => NOW })[REMEMBER_TOOL]!;
	}

	it("saves a note he just said, grows the subject branch and links the lesson", async () => {
		const store = memoryStore();
		const result = await tool(store, ["Honestly, show me the derivation first."]).execute("c1", { action: "remember", where: "subject", subject: "Physics", aspect: "explaining", text: "Show the derivation first.", quote: "show me the derivation first" } as never);
		assert.notEqual(result.isError, true);
		assert.equal(store.state.notes[0]!.status, "active");
		assert.equal(store.state.subjects[0]!.name, "Physics");
		assert.equal(store.state.chatSubjects.chat_a, "physics");
	});

	it("refuses a quote that is not his", async () => {
		const store = memoryStore();
		const result = await tool(store, ["I am fine"]).execute("c1", { action: "remember", where: "general", aspect: "background", text: "Is a physicist.", quote: "I am a physicist" } as never);
		assert.equal(result.isError, true);
		assert.equal(store.state.notes.length, 0);
	});

	it("refuses an automatic turn, where he wrote nothing", async () => {
		const store = memoryStore();
		const result = await tool(store, []).execute("c1", { action: "remember", where: "general", aspect: "background", text: "x", quote: "anything" } as never);
		assert.equal(result.isError, true);
	});

	it("forgets a note when he asks", async () => {
		const state = emptyLearnerState();
		const saved = applyWritten(state, { branchId: GENERAL_BRANCH, aspect: "skills", text: "Fluent in calculus.", now: NOW, newId });
		const store = memoryStore(state);
		const result = await tool(store, ["please forget the calculus note"]).execute("c1", { action: "forget", noteId: saved.noteId, quote: "forget the calculus note" } as never);
		assert.notEqual(result.isError, true);
		assert.equal(store.state.notes[0]!.status, "retired");
	});
});

function fauxEngine(steps: FauxResponseStep[]): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}
function submitEngine(input: unknown): PiEngine {
	return fauxEngine([() => fauxAssistantMessage([fauxToolCall("submit_learner_notes", input as ToolCall["arguments"], { id: "submit" })], { stopReason: "toolUse" })]);
}

describe("the background reader", () => {
	function lesson(): LhMessage[] {
		return [
			newUserMessage("teach me redshift"),
			newAnswerResult("q1", "quiz", { kind: "quiz", questionText: "Q1", dontKnow: false, answers: [], text: "lost the minus sign", answeredAt: NOW, correct: false }),
			newAnswerResult("q2", "quiz", { kind: "quiz", questionText: "Q2", dontKnow: false, answers: [], text: "sign error again", answeredAt: NOW, correct: false }),
		];
	}

	it("files what it notices, names the subject and moves its cursor", async () => {
		const messages = lesson();
		const store = memoryStore();
		const reader = createLearnerReader({
			chatStore: { getChat: () => ({ messages }) },
			learnerStore: store,
			engineFor: () => submitEngine({
				subject: { name: "Physics", description: "Cosmology" },
				findings: [{ where: "general", aspect: "struggles", text: "Check signs line by line in derivations.", sources: [messages[1]!.id, messages[2]!.id] }],
			}),
			now: () => NOW,
		});
		assert.equal(reader.due("chat_a"), true);
		const outcome = await reader.read("chat_a");
		assert.equal(outcome.subject, "Physics");
		assert.deepEqual(outcome.applied.map((a) => a.status), ["active"]);
		assert.equal(store.state.chatSubjects.chat_a, "physics");
		assert.equal(store.state.analyzed.chat_a, messages[2]!.id);
		assert.equal(reader.due("chat_a"), false);
	});

	it("does nothing without a model, and keeps its cursor", async () => {
		const messages = lesson();
		const store = memoryStore();
		const reader = createLearnerReader({ chatStore: { getChat: () => ({ messages }) }, learnerStore: store, engineFor: () => undefined });
		assert.equal((await reader.read("chat_a")).skipped, "no-model");
		assert.equal(store.state.analyzed.chat_a, undefined);
	});

	it("shows the reader only his messages as citable", () => {
		const { learnerMessageIds } = renderForReader(lesson(), undefined);
		assert.equal(learnerMessageIds.length, 3);
	});
});

describe("the learner tree on disk", () => {
	it("round-trips and refuses a corrupt file without touching it", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-learner-"));
		const file = path.join(dir, "learner.json");
		let writes = 0;
		const store = createLearnerStore(file, () => writes++);
		store.update((state) => { applyWritten(state, { branchId: GENERAL_BRANCH, aspect: "skills", text: "Knows Python.", now: NOW, newId }); });
		assert.equal(store.read().notes[0]!.text, "Knows Python.");
		assert.equal(writes, 1);
		fs.writeFileSync(file, '{"version":9}');
		assert.throws(() => store.read(), /invalid or from a newer app/);
		assert.equal(fs.readFileSync(file, "utf8"), '{"version":9}');
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("is part of the GitHub backup", () => {
		assert.equal(allowedLearningFile("learner.json"), true);
	});
});
