/** Server-side pure derivation. Inspired by MasteryHarness's evidence replay;
 * T3Learn uses explicitly enrolled capability objectives, not blanket node grades. */
import { createEmptyCard, fsrs, Rating } from "ts-fsrs";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ChatRecord } from "./contracts/chat.ts";
import type { LearningSession, ReviewEvidence, ReviewItem, ReviewSchedule } from "./learning.ts";
import { ASSESSMENTS } from "./learning.ts";

export function reviewEvidence(chat: ChatRecord, session: LearningSession): ReviewEvidence[] {
	if (chat.kind !== "practice" || session.kind !== "review" || chat.id !== session.chatId) return [];
	const selected = new Set(session.reviewItems.map(i => i.id));
	const clean = new Set(chat.messages.filter(m => m.role === "toolResult" && !(m as ToolResultMessage).isError).map(m => (m as ToolResultMessage).toolCallId));
	const seen = new Set<string>();
	const evidence: ReviewEvidence[] = [];
	let targets: string[] = [], problem = "";
	for (const message of chat.messages) {
		if (message.role === "custom" && message.customType === "problem-dismissed") { targets = []; continue; }
		if (message.role !== "assistant") continue;
		const assistant = message as AssistantMessage & { id?: string };
		for (const block of assistant.content) {
			if (block.type !== "toolCall" || !clean.has(block.id) || seen.has(block.id)) continue;
			seen.add(block.id);
			const input = block.arguments;
			if (block.name === "problem") {
				targets = Array.isArray(input.reviewTargets) ? input.reviewTargets.filter((id): id is string => typeof id === "string" && selected.has(id)) : [];
				problem = typeof input.statement === "string" ? input.statement : "";
			} else if (block.name === "conclude") {
				if (!["movedOn", "dismissed"].includes(String(input.outcome)) && Array.isArray(input.reviewAssessments)) {
					const used = new Set<string>();
					for (const raw of input.reviewAssessments) {
						if (!raw || typeof raw !== "object") continue;
						const a = raw as { itemId?: unknown; assessment?: unknown; reason?: unknown };
						if (typeof a.itemId !== "string" || !targets.includes(a.itemId) || used.has(a.itemId)
							|| !ASSESSMENTS.includes(a.assessment as never) || typeof a.reason !== "string" || !a.reason.trim()
							|| !Number.isFinite(assistant.timestamp)) continue;
						used.add(a.itemId);
						evidence.push({ itemId: a.itemId, assessment: a.assessment as ReviewEvidence["assessment"], reason: a.reason,
							chatId: chat.id, messageId: assistant.id ?? block.id, callId: block.id, at: new Date(assistant.timestamp).toISOString(), problem });
					}
				}
				targets = []; problem = "";
			}
		}
	}
	return evidence;
}

const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false, learning_steps: [], relearning_steps: [] });
export function reviewSchedules(items: readonly ReviewItem[], evidence: readonly ReviewEvidence[], now: Date): ReviewSchedule[] {
	return items.map(item => {
		const history = evidence.filter(e => e.itemId === item.id && e.at >= item.createdAt && e.at <= now.toISOString())
			.sort((a, b) => a.at.localeCompare(b.at) || a.chatId.localeCompare(b.chatId) || a.callId.localeCompare(b.callId));
		let card = createEmptyCard(new Date(item.createdAt));
		const sittings = new Set<string>();
		let lastReviewedAt: string | undefined;
		for (const event of history) {
			if (event.assessment === "unassessed" || sittings.has(event.chatId)) continue;
			sittings.add(event.chatId);
			const grade = event.assessment === "independent" ? Rating.Good : event.assessment === "supported" ? Rating.Hard : Rating.Again;
			card = scheduler.next(card, new Date(event.at), grade).card;
			lastReviewedAt = event.at;
		}
		const dueAt = card.due.toISOString();
		return { item, evidence: history, dueAt, lastReviewedAt,
			state: item.paused ? "paused" : !lastReviewedAt ? "untested" : dueAt <= now.toISOString() ? "due" : "upcoming" } as ReviewSchedule;
	}).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.item.id.localeCompare(b.item.id));
}
