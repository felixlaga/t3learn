import { learningProgress } from "../core/progress.ts";
import { getGraph } from "../core/graph.ts";
import { stores } from "./stores.ts";

/** Aggregate only: chat text, answers, and credentials never reach this endpoint. */
export function getLearningProgress(timeZone: string) {
	const records = stores.chatStore.listChats().flatMap(({ id }) => {
		const record = stores.chatStore.getChat(id); return record ? [record] : [];
	});
	const graph = getGraph(stores.graphStore);
	return learningProgress(records, { ideas: graph.nodes.length, connections: graph.chains.length }, Date.now(), timeZone);
}
