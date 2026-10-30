import { z } from "zod";
import { cliRequestAllowed } from "./cli-providers.ts";
import { stores } from "./stores.ts";
import {
	applyForget,
	applyWritten,
	ensureSubject,
	GENERAL_BRANCH,
	LEARNER_ASPECTS,
	LearnerRuleError,
	type LearnerAspect,
	type LearnerNote,
	type LearnerStore,
	type SubjectBranch,
} from "../core/learner.ts";
import { newNoteId } from "../agent/tools/learner.ts";
import { fallbackStatus } from "../agent/claude-fallback.ts";

/**
 * The learner tree's routes (owner, 2026-10-30): GET reads the tree for
 * the "How I learn" view; POST is his own edits there. What he writes is
 * in use at once and stays his (core/learner.ts applyWritten). Forgetting
 * retires a note for good.
 */

export interface LearnerViewNote {
	id: string; branchId: string; aspect: LearnerAspect; text: string;
	status: "observed" | "active"; origin: LearnerNote["origin"];
	updatedAt: string; quotes: string[]; lessons: Array<{ chatId: string; title: string }>;
	sightings: number;
}
export interface LearnerView {
	revision: number;
	subjects: SubjectBranch[];
	notes: LearnerViewNote[];
}

interface Deps { learnerStore: LearnerStore; chatStore: { getChat(id: string): { title: string } | null } }

export function learnerView(deps: Deps = stores): LearnerView {
	const state = deps.learnerStore.read();
	return {
		revision: state.revision,
		subjects: state.subjects,
		notes: state.notes.filter((n) => n.status !== "retired").map((n) => {
			const chatIds = [...new Set(n.evidence.map((e) => e.chatId).filter((id): id is string => !!id))];
			return {
				id: n.id, branchId: n.branchId, aspect: n.aspect, text: n.text,
				status: n.status as "observed" | "active", origin: n.origin, updatedAt: n.updatedAt,
				quotes: n.evidence.map((e) => e.quote).filter((q): q is string => !!q).slice(-3),
				lessons: chatIds.slice(-3).map((chatId) => ({ chatId, title: deps.chatStore.getChat(chatId)?.title ?? "A deleted lesson" })),
				sightings: new Set(n.evidence.flatMap((e) => e.messageIds)).size,
			};
		}),
	};
}

const text = z.string().trim().min(1).max(400);
const action = z.discriminatedUnion("action", [
	z.object({ action: z.literal("add"), branchId: z.string().min(1).max(128), aspect: z.enum(LEARNER_ASPECTS), text }).strict(),
	z.object({ action: z.literal("edit"), noteId: z.string().min(1).max(128), text }).strict(),
	z.object({ action: z.literal("forget"), noteId: z.string().min(1).max(128) }).strict(),
	z.object({ action: z.literal("addSubject"), name: z.string().trim().min(1).max(60), description: z.string().trim().max(300).default("") }).strict(),
]);

export function changeLearner(raw: unknown, deps: Deps = stores, now = new Date().toISOString()): void {
	const input = action.parse(raw);
	deps.learnerStore.update((state) => {
		if (input.action === "add") return applyWritten(state, { branchId: input.branchId, aspect: input.aspect, text: input.text, now, newId: newNoteId });
		if (input.action === "edit") return applyWritten(state, { branchId: GENERAL_BRANCH, aspect: "background", noteId: input.noteId, text: input.text, now, newId: newNoteId });
		if (input.action === "forget") return applyForget(state, { noteId: input.noteId, messageIds: [], now });
		ensureSubject(state, input.name, input.description, now);
		return { status: "active" as const };
	});
}

export async function learnerRoute(req: Request): Promise<Response> {
	if (!cliRequestAllowed(req)) return Response.json({ error: "The learning tree requires a local, same-origin window." }, { status: 403 });
	try {
		if (req.method === "GET") return Response.json(learnerView(), { headers: { "Cache-Control": "no-store" } });
		changeLearner(await req.json());
		return Response.json(learnerView());
	} catch (error) {
		const message = error instanceof z.ZodError ? "Check the note: it needs text under 400 characters."
			: error instanceof LearnerRuleError ? error.message
			: error instanceof Error ? error.message : "The learning tree could not be changed.";
		return Response.json({ error: message }, { status: 400 });
	}
}

/** GET: is Claude at its usage limit, and which Codex model stands in. */
export function fallbackRoute(): Response {
	return Response.json(fallbackStatus(), { headers: { "Cache-Control": "no-store" } });
}
