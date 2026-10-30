/**
 * THE LEARNER-TREE TOOL (owner, 2026-10-30): the live agents (prober,
 * teacher, practice) save what the learner SAYS about how he wants to be
 * taught, at once, into the learner tree (core/learner.ts). A note needs
 * a quote of his own words from this turn's input; without one the call
 * fails, so the agent cannot save its own guesses (Pacium's
 * recordLearning rule). Patterns in his answers are the background
 * reader's job (subagents/learner-reader.ts), not this tool's.
 *
 * Mechanics-only description; when to use it lives in
 * prompts/shared/18-how-he-learns.md.
 */

import { randomBytes } from "node:crypto";
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { invalidInputResult, toToolResult } from "../tool-execute.ts";
import {
	applyForget,
	applySaid,
	ensureSubject,
	findSubject,
	GENERAL_BRANCH,
	LEARNER_ASPECTS,
	LearnerRuleError,
	quoteFound,
	type LearnerAspect,
	type LearnerStore,
} from "../../core/learner.ts";

export const REMEMBER_TOOL = "remember_how_i_learn";

export interface LearnerToolContext {
	chatId: string;
	/** His own words in this turn's input (core/learner.ts learnerTextOf
	 *  over the input's appends). Empty for automatic turns. */
	learnerInput: { texts: string[]; messageIds: string[] };
	learnerStore: LearnerStore;
	now?: () => string;
}

export const newNoteId = () => `n${randomBytes(4).toString("hex")}`;

const params = Type.Object({
	action: Type.Union([Type.Literal("remember"), Type.Literal("forget")], {
		description: "remember: save a new note, or replace one. forget: drop the note named in noteId.",
	}),
	quote: Type.String({ minLength: 3, maxLength: 600, description: "His exact words from his latest message or answer that this note rests on." }),
	where: Type.Optional(Type.Union([Type.Literal("general"), Type.Literal("subject")], {
		description: "remember only. general: true in every subject. subject: about one subject.",
	})),
	subject: Type.Optional(Type.String({ minLength: 1, maxLength: 60, description: "remember with where=subject: the subject's name, like Physics. Reuse a name already in his tree." })),
	aspect: Type.Optional(Type.Union(LEARNER_ASPECTS.map((a) => Type.Literal(a)), {
		description: "remember only. For a subject: questions or explaining. For general: background, skills or struggles.",
	})),
	text: Type.Optional(Type.String({ minLength: 1, maxLength: 400, description: "remember only. One plain instruction to a future teacher." })),
	replaces: Type.Optional(Type.String({ description: "remember only. The id of the note this one replaces." })),
	noteId: Type.Optional(Type.String({ description: "forget only. The id of the note to drop." })),
});
type Input = Static<typeof params>;

export function learnerTools(ctx: LearnerToolContext): Record<string, AgentTool<any>> {
	const tool: AgentTool<typeof params> = {
		name: REMEMBER_TOOL,
		label: REMEMBER_TOOL,
		description: "Save or drop a note in his learning tree, based on what he just said about how he learns. The note is used in every later lesson.",
		parameters: params,
		executionMode: "sequential",
		execute: async (_toolCallId, input: Input) => {
			const problems = check(input, ctx);
			if (problems.length) return invalidInputResult(REMEMBER_TOOL, problems);
			const now = (ctx.now ?? (() => new Date().toISOString()))();
			try {
				const { result } = ctx.learnerStore.update((state) => {
					const common = { chatId: ctx.chatId, messageIds: ctx.learnerInput.messageIds, now };
					if (input.action === "forget") return applyForget(state, { ...common, noteId: input.noteId!, quote: input.quote });
					let branchId = GENERAL_BRANCH;
					if (input.where === "subject") {
						const name = input.subject?.trim() || state.subjects.find((s) => s.id === state.chatSubjects[ctx.chatId])?.name;
						if (!name) throw new LearnerRuleError("Name the subject in `subject`.");
						branchId = (findSubject(state, name) ?? ensureSubject(state, name, "", now)).id;
						state.chatSubjects[ctx.chatId] ??= branchId;
					}
					return applySaid(state, { ...common, branchId, aspect: input.aspect as unknown as LearnerAspect, text: input.text!, quote: input.quote, replaces: input.replaces, newId: newNoteId });
				});
				return toToolResult({ saved: result.status, noteId: result.noteId });
			} catch (error) {
				if (error instanceof LearnerRuleError) return invalidInputResult(REMEMBER_TOOL, [error.message]);
				throw error;
			}
		},
	};
	return { [REMEMBER_TOOL]: tool };
}

function check(input: Input, ctx: LearnerToolContext): string[] {
	const problems: string[] = [];
	if (!ctx.learnerInput.texts.length) problems.push("He wrote nothing in this turn's input, so there is nothing to quote. Save a note only right after he says it.");
	else if (!quoteFound(input.quote, ctx.learnerInput.texts)) problems.push("`quote` must be his exact words from his latest message or answer.");
	if (input.action === "forget") {
		if (!input.noteId) problems.push("forget needs `noteId`.");
		return problems;
	}
	if (!input.where) problems.push("remember needs `where`.");
	if (!input.aspect) problems.push("remember needs `aspect`.");
	if (!input.text?.trim()) problems.push("remember needs `text`.");
	return problems;
}
