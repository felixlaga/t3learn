import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { emptyLearnerState, learnerStateSchema, type LearnerState, type LearnerStore } from "../core/learner.ts";

/** The learner tree on disk (owner, 2026-10-30): one JSON file beside
 *  learning.json, written atomically, same discipline as the learning
 *  store. A corrupt or newer record is never overwritten. */
export function createLearnerStore(file = path.join(PATHS.data, "learner.json"), onWrite?: () => void): LearnerStore {
	function read(): LearnerState {
		if (!fs.existsSync(file)) return emptyLearnerState();
		const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		const result = learnerStateSchema.safeParse(parsed);
		if (!result.success) throw new Error("The learner tree is invalid or from a newer app. Restore a backup or use the matching app version; this file was not changed.");
		return result.data;
	}
	return {
		read,
		update(change) {
			const state = read();
			const result = change(state);
			state.revision++;
			if (!learnerStateSchema.safeParse(state).success) throw new Error("Invalid learner tree update.");
			fs.mkdirSync(path.dirname(file), { recursive: true });
			const temporary = `${file}.${process.pid}.tmp`;
			try { fs.writeFileSync(temporary, JSON.stringify(state, null, "\t"), { mode: 0o600 }); fs.renameSync(temporary, file); }
			finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
			onWrite?.();
			return { state, result };
		},
	};
}
