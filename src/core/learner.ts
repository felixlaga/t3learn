import { z } from "zod";
import type { LhMessage } from "./native-messages.ts";
import { compactAnswerForModel, type QuestionAnswerData } from "./question-core.ts";
import { QUESTION_TOOLS } from "./pending.ts";

/**
 * THE LEARNER TREE (owner, 2026-10-30): what the app knows about HOW the
 * learner learns, kept apart from the knowledge graph (which holds only
 * what is true, contracts/graph.ts). Modelled on Pacium's per-person
 * learning store (convex/feedback/learningMutations.ts there).
 *
 * The tree has two branches:
 *   - General: his background, his skills, what he struggles with.
 *     True in every subject.
 *   - Subjects: one branch per subject (open-ended, created as lessons
 *     reveal them), each holding how to ask him questions and how to
 *     explain things to him in that subject.
 *
 * The leaves are notes. The rules (owner, 2026-10-30, "3: kinda yes"):
 *   - What he SAYS (a quote of his own words in the current input) is
 *     in use at once. That includes "this question was bad".
 *   - What a background reader NOTICES in his answers is only observed.
 *     It comes into use once it is seen in at least two of his messages.
 *   - What he WRITES in the tree view is in use at once and stays his:
 *     the reader can add evidence but never change or retire it.
 *   - A forgotten note stays forgotten: noticing it again does nothing.
 * Only notes in use reach the teaching prompt (learnerBrief).
 *
 * Pure core: no IO. Ids and clocks come in as arguments.
 */

export const GENERAL_BRANCH = "general";
export const SUBJECT_ASPECTS = ["questions", "explaining"] as const;
export const GENERAL_ASPECTS = ["background", "skills", "struggles"] as const;
export const LEARNER_ASPECTS = [...SUBJECT_ASPECTS, ...GENERAL_ASPECTS] as const;
export type LearnerAspect = (typeof LEARNER_ASPECTS)[number];

/** The learner-facing labels (the tree view speaks to him). */
export const ASPECT_LABELS: Record<LearnerAspect, string> = {
	questions: "How to ask me questions",
	explaining: "How to explain things to me",
	background: "My background",
	skills: "My skills",
	struggles: "What I struggle with",
};

/** The prompt-facing labels (the prompts speak about him). */
const PROMPT_ASPECT_LABELS: Record<LearnerAspect, string> = {
	questions: "Asking him questions",
	explaining: "Explaining things to him",
	background: "His background",
	skills: "His skills",
	struggles: "What he struggles with",
};

export const NOTE_STATUSES = ["observed", "active", "retired"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];
/** said = his own words in a lesson; noticed = the background reader;
 *  written = typed by him in the tree view. */
export const NOTE_ORIGINS = ["said", "noticed", "written"] as const;
export type NoteOrigin = (typeof NOTE_ORIGINS)[number];

export const MAX_NOTE_TEXT = 400;
const MAX_EVIDENCE = 20;
/** Distinct learner messages a noticed pattern needs before it is used. */
export const NOTICED_THRESHOLD = 2;

const id = z.string().regex(/^[A-Za-z0-9_-]+$/).max(128);
const at = z.string().datetime();
const evidenceSchema = z.object({
	kind: z.enum(["said", "noticed", "written", "forget"]),
	at,
	chatId: id.optional(),
	messageIds: z.array(id).max(40),
	quote: z.string().max(600).optional(),
}).strict();
const noteSchema = z.object({
	id,
	branchId: id,
	aspect: z.enum(LEARNER_ASPECTS),
	text: z.string().min(1).max(MAX_NOTE_TEXT),
	status: z.enum(NOTE_STATUSES),
	origin: z.enum(NOTE_ORIGINS),
	evidence: z.array(evidenceSchema).max(MAX_EVIDENCE),
	createdAt: at,
	updatedAt: at,
	retiredAt: at.optional(),
	retiredBy: z.enum(["forgotten", "replaced"]).optional(),
	replacedBy: id.optional(),
}).strict();
const subjectSchema = z.object({ id, name: z.string().min(1).max(60), description: z.string().max(300), createdAt: at }).strict();
export const learnerStateSchema = z.object({
	version: z.literal(1),
	revision: z.number().int().nonnegative(),
	subjects: z.array(subjectSchema),
	notes: z.array(noteSchema),
	/** Which subject branch each lesson belongs to (set by the reader or
	 *  by a saved note). Absent = not known yet. */
	chatSubjects: z.record(id, id),
	/** The last message of each chat the background reader has read. */
	analyzed: z.record(id, id),
}).strict();

export type LearnerEvidence = z.infer<typeof evidenceSchema>;
export type LearnerNote = z.infer<typeof noteSchema>;
export type SubjectBranch = z.infer<typeof subjectSchema>;
export type LearnerState = z.infer<typeof learnerStateSchema>;

export interface LearnerStore {
	read(): LearnerState;
	update<T>(change: (state: LearnerState) => T): { state: LearnerState; result: T };
}

export const emptyLearnerState = (): LearnerState => ({
	version: 1, revision: 0, subjects: [], notes: [], chatSubjects: {}, analyzed: {},
});

export class LearnerRuleError extends Error {}

/** The aspects a branch may hold. */
export function aspectsFor(branchId: string): readonly LearnerAspect[] {
	return branchId === GENERAL_BRANCH ? GENERAL_ASPECTS : SUBJECT_ASPECTS;
}

export function subjectIdFor(name: string): string {
	const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
	return slug && slug !== GENERAL_BRANCH ? slug : "subject";
}

export function findSubject(state: LearnerState, nameOrId: string): SubjectBranch | undefined {
	const wanted = nameOrId.trim().toLowerCase();
	return state.subjects.find((s) => s.id === wanted || s.name.toLowerCase() === wanted || s.id === subjectIdFor(nameOrId));
}

/** Find a subject branch by name or id, or grow a new one. */
export function ensureSubject(state: LearnerState, name: string, description: string, now: string): SubjectBranch {
	const existing = findSubject(state, name);
	if (existing) {
		if (!existing.description && description.trim()) existing.description = description.trim().slice(0, 300);
		return existing;
	}
	const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
	if (!clean) throw new LearnerRuleError("A subject needs a name.");
	let branchId = subjectIdFor(clean);
	for (let n = 2; state.subjects.some((s) => s.id === branchId); n++) branchId = `${subjectIdFor(clean)}-${n}`;
	const subject = { id: branchId, name: clean, description: description.trim().slice(0, 300), createdAt: now };
	state.subjects.push(subject);
	return subject;
}

function branchExists(state: LearnerState, branchId: string): boolean {
	return branchId === GENERAL_BRANCH || state.subjects.some((s) => s.id === branchId);
}

function checkPlace(state: LearnerState, branchId: string, aspect: LearnerAspect) {
	if (!branchExists(state, branchId)) throw new LearnerRuleError("That subject is not in the tree.");
	if (!aspectsFor(branchId).includes(aspect)) {
		throw new LearnerRuleError(branchId === GENERAL_BRANCH
			? `General notes are about: ${GENERAL_ASPECTS.join(", ")}.`
			: `Subject notes are about: ${SUBJECT_ASPECTS.join(", ")}.`);
	}
}

function cleanText(text: string): string {
	const clean = text.trim().replace(/\s+/g, " ");
	if (!clean) throw new LearnerRuleError("A note needs text.");
	if (clean.length > MAX_NOTE_TEXT) throw new LearnerRuleError(`Keep a note under ${MAX_NOTE_TEXT} characters.`);
	return clean;
}

const comparable = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Does the quote appear in what he wrote? Case, spacing and quote marks
 *  do not matter; a quote under three characters never counts. */
export function quoteFound(quote: string, learnerTexts: readonly string[]): boolean {
	const wanted = comparable(quote);
	if (wanted.length < 3) return false;
	return learnerTexts.some((text) => comparable(text).includes(wanted));
}

function addEvidence(note: LearnerNote, evidence: LearnerEvidence) {
	note.evidence = [...note.evidence, evidence].slice(-MAX_EVIDENCE);
	note.updatedAt = evidence.at;
}

function liveNote(state: LearnerState, noteId: string): LearnerNote {
	const note = state.notes.find((n) => n.id === noteId);
	if (!note || note.status === "retired") throw new LearnerRuleError(`No note in use or waiting has the id ${noteId}.`);
	return note;
}

function sameText(state: LearnerState, branchId: string, aspect: LearnerAspect, text: string, statuses: readonly NoteStatus[]) {
	const wanted = comparable(text);
	return state.notes.find((n) => n.branchId === branchId && n.aspect === aspect && statuses.includes(n.status) && comparable(n.text) === wanted);
}

export type ApplyStatus = "active" | "observed" | "unchanged" | "ignored" | "forgotten";
export interface ApplyResult { status: ApplyStatus; noteId?: string }

interface Common { chatId?: string; messageIds: string[]; now: string }

/** His own words: in use at once. `replaces` retires the note it supersedes. */
export function applySaid(
	state: LearnerState,
	input: Common & { branchId: string; aspect: LearnerAspect; text: string; quote: string; replaces?: string; newId: () => string },
): ApplyResult {
	checkPlace(state, input.branchId, input.aspect);
	const text = cleanText(input.text);
	const evidence: LearnerEvidence = { kind: "said", at: input.now, ...(input.chatId ? { chatId: input.chatId } : {}), messageIds: input.messageIds, quote: input.quote.slice(0, 600) };
	const replaced = input.replaces ? liveNote(state, input.replaces) : undefined;
	const same = sameText(state, input.branchId, input.aspect, text, ["observed", "active"]);
	if (same && same !== replaced) {
		const wasActive = same.status === "active";
		same.status = "active";
		if (same.origin === "noticed") same.origin = "said";
		addEvidence(same, evidence);
		return { status: wasActive ? "unchanged" : "active", noteId: same.id };
	}
	const note: LearnerNote = {
		id: input.newId(), branchId: input.branchId, aspect: input.aspect, text, status: "active", origin: "said",
		evidence: [evidence], createdAt: input.now, updatedAt: input.now,
	};
	if (replaced) Object.assign(replaced, { status: "retired", retiredAt: input.now, retiredBy: "replaced", replacedBy: note.id, updatedAt: input.now });
	state.notes.push(note);
	return { status: "active", noteId: note.id };
}

/** He asked to drop a note: retired for good. */
export function applyForget(state: LearnerState, input: Common & { noteId: string; quote?: string }): ApplyResult {
	const note = liveNote(state, input.noteId);
	addEvidence(note, { kind: "forget", at: input.now, ...(input.chatId ? { chatId: input.chatId } : {}), messageIds: input.messageIds, ...(input.quote ? { quote: input.quote.slice(0, 600) } : {}) });
	Object.assign(note, { status: "retired", retiredAt: input.now, retiredBy: "forgotten" });
	return { status: "forgotten", noteId: note.id };
}

/** A pattern the background reader saw in his answers. It is used only
 *  once its evidence spans NOTICED_THRESHOLD distinct learner messages.
 *  It never changes what he said or wrote, and never revives what he
 *  forgot. */
export function applyNoticed(
	state: LearnerState,
	input: Common & { branchId: string; aspect: LearnerAspect; text: string; supports?: string; newId: () => string },
): ApplyResult {
	checkPlace(state, input.branchId, input.aspect);
	const text = cleanText(input.text);
	const evidence: LearnerEvidence = { kind: "noticed", at: input.now, ...(input.chatId ? { chatId: input.chatId } : {}), messageIds: [...new Set(input.messageIds)] };
	const target = input.supports ? state.notes.find((n) => n.id === input.supports) : sameText(state, input.branchId, input.aspect, text, ["observed", "active"]);
	if (target?.status === "retired") return { status: "ignored", noteId: target.id };
	if (!target && sameText(state, input.branchId, input.aspect, text, ["retired"])) return { status: "ignored" };
	if (target) {
		addEvidence(target, evidence);
		if (target.status === "active") return { status: "unchanged", noteId: target.id };
		if (distinctMessages(target) >= NOTICED_THRESHOLD) {
			target.status = "active";
			return { status: "active", noteId: target.id };
		}
		return { status: "observed", noteId: target.id };
	}
	const note: LearnerNote = {
		id: input.newId(), branchId: input.branchId, aspect: input.aspect, text, status: "observed", origin: "noticed",
		evidence: [evidence], createdAt: input.now, updatedAt: input.now,
	};
	if (distinctMessages(note) >= NOTICED_THRESHOLD) note.status = "active";
	state.notes.push(note);
	return { status: note.status === "active" ? "active" : "observed", noteId: note.id };
}

function distinctMessages(note: LearnerNote): number {
	return new Set(note.evidence.filter((e) => e.kind === "noticed" || e.kind === "said").flatMap((e) => e.messageIds)).size;
}

/** He typed it in the tree view: new, or an edit of an existing note.
 *  Either way it is in use and it is his. */
export function applyWritten(
	state: LearnerState,
	input: { branchId: string; aspect: LearnerAspect; text: string; noteId?: string; now: string; newId: () => string },
): ApplyResult {
	const text = cleanText(input.text);
	const evidence: LearnerEvidence = { kind: "written", at: input.now, messageIds: [] };
	if (input.noteId) {
		const note = liveNote(state, input.noteId);
		Object.assign(note, { text, status: "active", origin: "written" });
		addEvidence(note, evidence);
		return { status: "active", noteId: note.id };
	}
	checkPlace(state, input.branchId, input.aspect);
	const note: LearnerNote = {
		id: input.newId(), branchId: input.branchId, aspect: input.aspect, text, status: "active", origin: "written",
		evidence: [evidence], createdAt: input.now, updatedAt: input.now,
	};
	state.notes.push(note);
	return { status: "active", noteId: note.id };
}

// ─── Reading the tree into a prompt ────────────────────────────────────────

const BRIEF_NOTE_LIMIT = 60;

function noteLines(notes: readonly LearnerNote[], aspects: readonly LearnerAspect[]): string[] {
	const lines: string[] = [];
	for (const aspect of aspects) {
		const here = notes.filter((n) => n.aspect === aspect);
		if (!here.length) continue;
		lines.push(`${PROMPT_ASPECT_LABELS[aspect]}:`);
		for (const n of here) lines.push(`- [${n.id}] ${n.text}`);
	}
	return lines;
}

/** The "How he learns" section appended to every teaching prompt. Only
 *  notes in use appear. The lesson's own subject comes first when known;
 *  otherwise every subject is listed and the agent picks the one that fits. */
export function learnerBrief(state: LearnerState, chatId: string | undefined): string {
	const active = state.notes.filter((n) => n.status === "active").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const subjectId = chatId ? state.chatSubjects[chatId] : undefined;
	const lesson = state.subjects.find((s) => s.id === subjectId);
	const parts: string[] = [
		"# How he learns",
		"These notes come from earlier lessons. He said some of them himself. Others showed up at least twice in his answers. Follow them. What he says in this lesson wins over any note. A note for this lesson's subject wins over a general note. The id in brackets is for `remember_how_i_learn`.",
	];
	let budget = BRIEF_NOTE_LIMIT;
	const take = (notes: LearnerNote[]) => { const kept = notes.slice(-Math.max(0, budget)); budget -= kept.length; return kept; };
	const general = noteLines(take(active.filter((n) => n.branchId === GENERAL_BRANCH)), GENERAL_ASPECTS);
	parts.push(`## General\n${general.length ? general.join("\n") : "No notes yet."}`);
	if (lesson) {
		const lines = noteLines(take(active.filter((n) => n.branchId === lesson.id)), SUBJECT_ASPECTS);
		parts.push(`## ${lesson.name} (the subject of this lesson)\n${lines.length ? lines.join("\n") : "No notes yet."}`);
	} else {
		for (const subject of state.subjects) {
			const lines = noteLines(take(active.filter((n) => n.branchId === subject.id)), SUBJECT_ASPECTS);
			if (lines.length) parts.push(`## ${subject.name} (use only if this lesson is about ${subject.name})\n${lines.join("\n")}`);
		}
	}
	const known = state.subjects.map((s) => s.name);
	parts.push(known.length ? `Subjects in his tree: ${known.join(", ")}. Reuse these names when you save a note.` : "His tree has no subjects yet.");
	return parts.join("\n\n");
}

// ─── Reading what he wrote ─────────────────────────────────────────────────

/** His own words in a run of messages: typed messages, the free-text
 *  parts of his answers, and his practice thinking. Option labels he
 *  picked are not his words, so they never count as a quote. */
export function learnerTextOf(messages: readonly LhMessage[]): { texts: string[]; messageIds: string[] } {
	const texts: string[] = [], messageIds: string[] = [];
	const push = (messageId: string, parts: Array<string | undefined>) => {
		const own = parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
		if (!own.length) return;
		texts.push(...own);
		messageIds.push(messageId);
	};
	for (const m of messages) {
		if (m.role === "user") {
			push(m.id, typeof m.content === "string" ? [m.content] : m.content.map((c) => (c.type === "text" ? c.text : undefined)));
		} else if (m.role === "toolResult" && (QUESTION_TOOLS as readonly string[]).includes(m.toolName)) {
			const a = m.details as Partial<QuestionAnswerData> | undefined;
			if (a && typeof a === "object") push(m.id, [a.text, a.other, a.thinking ?? a.note, a.readingThinking]);
		} else if (m.role === "custom" && m.customType === "late-answer") {
			const a = (m.details as { answer?: Partial<QuestionAnswerData> } | undefined)?.answer;
			if (a && typeof a === "object") push(m.id, [a.text, a.other, a.thinking ?? a.note]);
		} else if (m.role === "custom" && m.customType === "practice-thinking") {
			push(m.id, [(m.details as { text?: string } | undefined)?.text]);
		}
	}
	return { texts, messageIds };
}

/** How many of his inputs come after the reader's cursor. */
export function learnerInputsAfter(messages: readonly LhMessage[], cursor: string | undefined): number {
	const start = cursor ? messages.findIndex((m) => m.id === cursor) + 1 : 0;
	return messages.slice(start).filter(isLearnerInput).length;
}

function isLearnerInput(m: LhMessage): boolean {
	return m.role === "user"
		|| (m.role === "toolResult" && (QUESTION_TOOLS as readonly string[]).includes(m.toolName) && !(m.details as { waiting?: boolean } | undefined)?.waiting)
		|| (m.role === "custom" && (m.customType === "practice-thinking" || m.customType === "late-answer"));
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The lesson since the cursor, as plain text for the background reader.
 *  Each of his inputs carries its message id so a finding can cite it. */
export function renderForReader(messages: readonly LhMessage[], cursor: string | undefined, maxChars = 40_000): {
	text: string; learnerMessageIds: string[]; lastId: string | undefined;
} {
	const start = cursor ? messages.findIndex((m) => m.id === cursor) + 1 : 0;
	const slice = messages.slice(start);
	const blocks: string[] = [];
	const learnerMessageIds: string[] = [];
	for (const m of slice) {
		if (m.role === "assistant") {
			for (const part of m.content) {
				if (part.type === "text" && part.text.trim()) blocks.push(`TEACHER:\n${clip(part.text.trim(), 2500)}`);
				if (part.type === "toolCall") blocks.push(`TEACHER called ${part.name}:\n${clip(JSON.stringify(part.arguments), 2500)}`);
			}
		} else if (m.role === "user") {
			const text = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
			if (text.trim()) { blocks.push(`LEARNER [${m.id}] wrote:\n${clip(text.trim(), 2500)}`); learnerMessageIds.push(m.id); }
		} else if (m.role === "toolResult" && (QUESTION_TOOLS as readonly string[]).includes(m.toolName)) {
			if ((m.details as { waiting?: boolean } | undefined)?.waiting) continue; // no answer yet
			const answer = m.details && typeof m.details === "object" ? compactAnswerForModel(m.details as unknown as QuestionAnswerData) : {};
			blocks.push(`LEARNER [${m.id}] answered ${m.toolName}:\n${clip(JSON.stringify(answer), 2500)}`);
			learnerMessageIds.push(m.id);
		} else if (m.role === "custom" && m.customType === "late-answer") {
			const late = m.details as { tool?: string; answer?: QuestionAnswerData } | undefined;
			if (!late?.answer) continue;
			blocks.push(`LEARNER [${m.id}] answered ${late.tool ?? "a question"} (it waited while he chatted):\n${clip(JSON.stringify(compactAnswerForModel(late.answer)), 2500)}`);
			learnerMessageIds.push(m.id);
		} else if (m.role === "custom" && m.customType === "practice-thinking") {
			const text = (m.details as { text?: string } | undefined)?.text ?? "";
			if (text.trim()) { blocks.push(`LEARNER [${m.id}] thinking on the problem:\n${clip(text.trim(), 2500)}`); learnerMessageIds.push(m.id); }
		}
	}
	let text = blocks.join("\n\n");
	if (text.length > maxChars) text = `(earlier part cut)\n${text.slice(text.length - maxChars)}`;
	return { text, learnerMessageIds, lastId: slice.at(-1)?.id ?? cursor };
}
