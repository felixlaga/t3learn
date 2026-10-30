/**
 * THE LEARNER-TREE READER (owner, 2026-10-30): a background agent that
 * reads each new stretch of a lesson and notices how the learner learns —
 * question shapes he keeps missing, explanations that did or did not
 * work, his background and skills. It writes into the learner tree
 * (core/learner.ts) as NOTICED notes: a note is used in lessons only
 * once it is seen in at least two of his messages. It never changes a
 * note he said or wrote, and never revives one he forgot.
 *
 * It also names the lesson's subject, so the right subject branch reaches
 * the next turn's prompt.
 *
 * Fire-and-forget from the turn's settle (chat-handler), one run per chat
 * at a time, under the shared background permit pool. A run that fails
 * leaves the cursor where it was, so the next trigger reads the stretch
 * again.
 */

import { Type, type Static } from "typebox";
import type { PiEngine } from "../models.ts";
import { runSubmitAgent } from "./submit-agent.ts";
import { withBgLlmSlot } from "./bg-llm-semaphore.ts";
import { newNoteId } from "../tools/learner.ts";
import type { LhMessage } from "../../core/native-messages.ts";
import {
	ASPECT_LABELS,
	applyNoticed,
	ensureSubject,
	GENERAL_ASPECTS,
	GENERAL_BRANCH,
	LEARNER_ASPECTS,
	learnerInputsAfter,
	LearnerRuleError,
	renderForReader,
	SUBJECT_ASPECTS,
	type ApplyStatus,
	type LearnerAspect,
	type LearnerState,
	type LearnerStore,
} from "../../core/learner.ts";

/** The reader runs once this many of his inputs wait unread. */
export const READ_EVERY = 3;
const SUBMIT_TOOL = "submit_learner_notes";

export const READER_SYSTEM_PROMPT = `You read one stretch of a lesson. You look for how this learner learns. You do not judge what is true about the subject. Another system keeps the facts. You keep notes on how to teach him.

His learning tree has two branches. General holds his background, his skills, and what he struggles with in every subject. Each subject has its own branch. It holds how to ask him questions and how to explain things to him in that subject.

Look for these signs in his answers and messages:
- He misses questions of one shape again and again. For example, he gets the idea but loses track of signs in a derivation.
- An explanation did not work. He said he was lost, asked the same thing again, or answered as if he had not read it.
- An explanation did work. He answered right, with high confidence, just after a certain kind of explanation.
- He showed a skill or a gap that matters in every subject, like ease with calculus or trouble with long proofs.
- He mentioned his background, like a course he took or his job.

Write each finding as one plain instruction to a future teacher. Example: "Give one worked example with numbers before the general formula." Keep it about teaching him, not about one fact of the subject. A wrong belief about one topic is a fact about that topic, so it does not belong here.

Cite the ids of his messages that show it in \`sources\`. Only his messages count, and each id is in square brackets. If a finding matches a note already in his tree, pass that note's id in \`supports\` and reuse its words. Never write a note that matches one he asked to forget.

Most stretches hold no finding. Then submit an empty list. Do not guess. Two clear findings beat five vague ones.

Also name the subject of this lesson, like Physics or Philosophy, with one short line on what it covers. Reuse a subject name from his tree when it fits.`;

const findingSchema = Type.Object({
	where: Type.Union([Type.Literal("general"), Type.Literal("subject")], { description: "general: true in every subject. subject: about this lesson's subject." }),
	aspect: Type.Union(LEARNER_ASPECTS.map((a) => Type.Literal(a)), { description: "For a subject: questions or explaining. For general: background, skills or struggles." }),
	text: Type.String({ minLength: 1, maxLength: 400, description: "One plain instruction to a future teacher." }),
	sources: Type.Array(Type.String(), { minItems: 1, maxItems: 12, description: "Ids of his messages that show it." }),
	supports: Type.Optional(Type.String({ description: "The id of the note in his tree this matches." })),
});
const submitSchema = Type.Object({
	subject: Type.Optional(Type.Object({
		name: Type.String({ minLength: 1, maxLength: 60 }),
		description: Type.String({ maxLength: 300 }),
	}, { description: "The subject of this lesson." })),
	findings: Type.Array(findingSchema, { maxItems: 4 }),
});
type Submission = Static<typeof submitSchema>;

export interface LearnerReaderDeps {
	chatStore: { getChat(id: string): { messages: LhMessage[] } | null };
	learnerStore: LearnerStore;
	/** The reader's engine, resolved fresh per run (cheap tier). */
	engineFor: () => PiEngine | undefined;
	now?: () => string;
}

export interface ReaderOutcome {
	skipped?: "running" | "no-chat" | "nothing-new" | "no-model";
	subject?: string;
	applied: Array<{ text: string; status: ApplyStatus }>;
}

function describeTree(state: LearnerState, chatId: string): string {
	const branchName = (id: string) => (id === GENERAL_BRANCH ? "General" : state.subjects.find((s) => s.id === id)?.name ?? id);
	const live = state.notes.filter((n) => n.status !== "retired");
	const forgotten = state.notes.filter((n) => n.retiredBy === "forgotten");
	const lesson = state.subjects.find((s) => s.id === state.chatSubjects[chatId]);
	return [
		`Subjects in his tree: ${state.subjects.length ? state.subjects.map((s) => `${s.name}${s.description ? ` (${s.description})` : ""}`).join("; ") : "none yet"}.`,
		`The subject of this lesson so far: ${lesson?.name ?? "not known yet"}.`,
		"Notes in his tree:",
		...(live.length ? live.map((n) => `- [${n.id}] ${branchName(n.branchId)} / ${ASPECT_LABELS[n.aspect]} / ${n.status === "active" ? "in use" : "seen once"}: ${n.text}`) : ["- none yet"]),
		...(forgotten.length ? ["Notes he asked to forget (never write these again):", ...forgotten.map((n) => `- ${n.text}`)] : []),
	].join("\n");
}

export function createLearnerReader(deps: LearnerReaderDeps) {
	const running = new Set<string>();
	const now = deps.now ?? (() => new Date().toISOString());

	/** Enough unread input to be worth a run? */
	function due(chatId: string): boolean {
		const record = deps.chatStore.getChat(chatId);
		if (!record) return false;
		return learnerInputsAfter(record.messages, deps.learnerStore.read().analyzed[chatId]) >= READ_EVERY;
	}

	async function read(chatId: string, signal?: AbortSignal): Promise<ReaderOutcome> {
		if (running.has(chatId)) return { skipped: "running", applied: [] };
		running.add(chatId);
		try {
			const record = deps.chatStore.getChat(chatId);
			if (!record) return { skipped: "no-chat", applied: [] };
			const before = deps.learnerStore.read();
			const cursor = before.analyzed[chatId];
			const known = cursor && record.messages.some((m) => m.id === cursor) ? cursor : undefined;
			const stretch = renderForReader(record.messages, known);
			if (!stretch.learnerMessageIds.length) {
				if (stretch.lastId) deps.learnerStore.update((state) => { state.analyzed[chatId] = stretch.lastId!; });
				return { skipped: "nothing-new", applied: [] };
			}
			const engine = deps.engineFor();
			if (!engine) return { skipped: "no-model", applied: [] };
			const sources = new Set(stretch.learnerMessageIds);
			const lessonSubject = before.chatSubjects[chatId];
			const submission = await withBgLlmSlot(signal, () => runSubmitAgent<Submission>({
				role: "learnerReader",
				toolName: SUBMIT_TOOL,
				toolDescription: "Submit the subject of this lesson and your findings about how he learns. An empty findings list is a normal answer.",
				parameters: submitSchema,
				fill: (input) => ({ subject: input.subject, findings: input.findings ?? [] }),
				systemPrompt: READER_SYSTEM_PROMPT,
				prompt: `${describeTree(before, chatId)}\n\nThe lesson stretch:\n\n${stretch.text}`,
				engine,
				signal,
				onStep: () => {},
				neverSubmitted: "The learner-tree reader never submitted its notes.",
				validate: (value) => validate(value, before, sources, Boolean(lessonSubject)),
			}));
			const at = now();
			const { result } = deps.learnerStore.update((state) => {
				let subjectId = state.chatSubjects[chatId];
				let subjectName = state.subjects.find((s) => s.id === subjectId)?.name;
				if (submission.subject && !subjectId) {
					const subject = ensureSubject(state, submission.subject.name, submission.subject.description, at);
					state.chatSubjects[chatId] = subjectId = subject.id;
					subjectName = subject.name;
				}
				const applied: ReaderOutcome["applied"] = [];
				for (const finding of submission.findings) {
					const branchId = finding.where === "general" ? GENERAL_BRANCH : subjectId;
					if (!branchId) continue;
					try {
						const outcome = applyNoticed(state, {
							chatId, branchId, aspect: finding.aspect as LearnerAspect, text: finding.text,
							supports: finding.supports, messageIds: finding.sources.filter((s) => sources.has(s)), now: at, newId: newNoteId,
						});
						applied.push({ text: finding.text, status: outcome.status });
					} catch (error) {
						if (!(error instanceof LearnerRuleError)) throw error;
					}
				}
				if (stretch.lastId) state.analyzed[chatId] = stretch.lastId;
				return { subject: subjectName, applied };
			});
			return result;
		} finally {
			running.delete(chatId);
		}
	}

	return { due, read };
}

export type LearnerReader = ReturnType<typeof createLearnerReader>;

function validate(value: Submission, state: LearnerState, sources: ReadonlySet<string>, subjectKnown: boolean): string | null {
	if (!subjectKnown && !value.subject && value.findings.some((f) => f.where === "subject")) {
		return "Name the subject of this lesson in `subject` before you file a subject finding.";
	}
	for (const [i, f] of value.findings.entries()) {
		const allowed = f.where === "general" ? GENERAL_ASPECTS : SUBJECT_ASPECTS;
		if (!(allowed as readonly string[]).includes(f.aspect)) return `findings.${i}: ${f.where} findings use aspect ${allowed.join(" or ")}.`;
		if (!f.sources.some((s) => sources.has(s))) return `findings.${i}: cite at least one id of his messages from this stretch in \`sources\`.`;
		if (f.supports) {
			const note = state.notes.find((n) => n.id === f.supports);
			if (!note || note.status === "retired") return `findings.${i}: no note in his tree has the id ${f.supports}.`;
			if (note.aspect !== f.aspect || (f.where === "general") !== (note.branchId === GENERAL_BRANCH)) return `findings.${i}: \`supports\` must name a note in the same branch and aspect.`;
		}
	}
	return null;
}
