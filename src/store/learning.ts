import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PATHS } from "../../config.ts";
import { emptyLearningState, goalInputSchema, idSchema, reviewInputSchema, SUBJECTS, type LearningState, type LearningStore } from "../core/learning.ts";

const timestamp = z.string().datetime();
// Intersections cannot be strict on the input half: validate stored metadata separately.
const goalStored = z.object({ id: idSchema, createdAt: timestamp, updatedAt: timestamp }).passthrough().superRefine((g, ctx) => {
	const { id: _id, createdAt: _created, updatedAt: _updated, ...input } = g;
	if (!goalInputSchema.safeParse(input).success) ctx.addIssue({ code: "custom", message: "Invalid stored learning goal." });
});
const item = reviewInputSchema.extend({ id: idSchema, createdAt: timestamp, paused: z.boolean() });
const session = z.object({
	chatId: idSchema, kind: z.enum(["goal", "review"]), subject: z.enum(SUBJECTS), minutes: z.number().int().min(1).max(240), startedAt: timestamp,
	goalId: idSchema.optional(), stepId: idSchema.optional(), goalTitle: z.string().optional(), goalOutcome: z.string().optional(), stepTitle: z.string().optional(),
	repairObjective: z.string().optional(), reviewItems: z.array(item).max(64), nextGoalId: idSchema.optional(), nextGoalMinutes: z.number().int().min(1).max(240).optional(),
}).strict();
const stateSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), dailyMinutes: z.number().int().min(5).max(240),
	goals: z.array(goalStored), reviewItems: z.array(item), sessions: z.record(idSchema, session),
}).strict();

/** Atomic single-process adapter, same data-dir seam as chats. A corrupt/newer record is never overwritten. */
export function createLearningStore(file = path.join(PATHS.data, "learning.json")): LearningStore {
	function read(): LearningState {
		if (!fs.existsSync(file)) return emptyLearningState();
		const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		const result = stateSchema.safeParse(parsed);
		if (!result.success) throw new Error("Learning records are invalid or from a newer app. Restore a backup or use the matching app version; this file was not changed.");
		return result.data as unknown as LearningState;
	}
	return { read, update(change) {
		const state = read();
		change(state); state.revision++;
		if (!stateSchema.safeParse(state).success) throw new Error("Invalid learning record update.");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const temporary = `${file}.${process.pid}.tmp`;
		try { fs.writeFileSync(temporary, JSON.stringify(state, null, "\t"), { mode: 0o600 }); fs.renameSync(temporary, file); }
		finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
		return state;
	} };
}
