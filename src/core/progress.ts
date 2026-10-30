import type { ChatRecord } from "./contracts/chat.ts";

export const ANSWER_XP = 20;
export const LEVEL_XP = 200;
const LEARNING_TOOLS = new Set(["quiz", "probe", "explain", "recall"]);
const DAY = 86_400_000;

export interface ProgressDay { date: string; activities: number; answers: number }
export interface ProgressBadge {
	id: string; name: string; description: string; value: number; target: number; unlocked: boolean;
}
export interface LearningProgress {
	timeZone: string; today: string; xp: number; level: number; levelXp: number; nextLevelXp: number;
	answers: number; sessions: number; practiceSessions: number; activeDays: number;
	currentStreak: number; bestStreak: number; ideas: number; connections: number;
	calendar: ProgressDay[]; badges: ProgressBadge[];
}

export function validProgressTimeZone(timeZone: string): boolean {
	try { new Intl.DateTimeFormat("en", { timeZone }).format(0); return true; } catch { return false; }
}

/** A read-only fold of durable learner events. XP never enters an agent prompt,
 * changes grading, or writes a second ledger. Removing history removes its XP. */
export function learningProgress(
	records: readonly Pick<ChatRecord, "id" | "kind" | "messages">[],
	graph: { ideas: number; connections: number },
	now: number,
	timeZone: string,
): LearningProgress {
	const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
	const dayOf = (timestamp: number) => {
		const parts = formatter.formatToParts(timestamp);
		return ["year", "month", "day"].map((key) => parts.find((p) => p.type === key)!.value).join("-");
	};
	const today = dayOf(now);
	const todayIndex = Date.parse(today + "T00:00:00Z") / DAY;
	const dateOf = (index: number) => new Date(index * DAY).toISOString().slice(0, 10);
	const activity = new Map<string, ProgressDay>();
	let answers = 0, sessions = 0, practiceSessions = 0;
	const add = (timestamp: number, answer: boolean) => {
		if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) return false;
		const date = dayOf(timestamp);
		const day = activity.get(date) ?? { date, activities: 0, answers: 0 };
		day.activities++; if (answer) day.answers++;
		activity.set(date, day); return true;
	};
	const chatsSeen = new Set<string>();
	for (const record of records) {
		if (chatsSeen.has(record.id) || !Array.isArray(record.messages)) continue;
		chatsSeen.add(record.id);
		const calls = new Map<string, string>(), seenAnswers = new Set<string>(), seenMessages = new Set<string>();
		let participated = false;
		for (const message of record.messages) {
			if (!message || seenMessages.has(message.id)) continue;
			seenMessages.add(message.id);
			if (message.role === "assistant" && Array.isArray(message.content)) {
				for (const part of message.content) if (part.type === "toolCall" && LEARNING_TOOLS.has(part.name)) calls.set(part.id, part.name);
			} else if (message.role === "user" || message.role === "custom" && ["practice-thinking", "practice-next"].includes(message.customType)) {
				if (add(message.timestamp, false)) participated = true;
			} else if (message.role === "custom" && message.customType === "late-answer") {
				// An answer that waited while he chatted (owner, 2026-10-30).
				const late = message.details as { toolCallId?: string; tool?: string; answer?: Record<string, unknown> } | undefined;
				const detail = late?.answer;
				if (!late?.toolCallId || calls.get(late.toolCallId) !== late.tool || seenAnswers.has(late.toolCallId) || !detail || typeof detail !== "object") continue;
				if (detail.dismissed || !["quiz", "explain"].includes(String(detail.kind))) continue;
				if (typeof detail.answeredAt !== "string" || !Array.isArray(detail.answers) || typeof detail.dontKnow !== "boolean") continue;
				if (add(Date.parse(detail.answeredAt), true)) { seenAnswers.add(late.toolCallId); answers++; participated = true; }
			} else if (message.role === "toolResult" && !message.isError && calls.get(message.toolCallId) === message.toolName && !seenAnswers.has(message.toolCallId)) {
				const raw = message.details;
				if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
				const detail = raw as Record<string, unknown>;
				if (detail.dismissed || detail.waiting || !["quiz", "explain"].includes(String(detail.kind))) continue;
				// Require the structured answer record, excluding validation errors and synthetic tool results.
				if (typeof detail.answeredAt !== "string" || !Array.isArray(detail.answers) || typeof detail.dontKnow !== "boolean") continue;
				const timestamp = Date.parse(detail.answeredAt);
				if (add(timestamp, true)) { seenAnswers.add(message.toolCallId); answers++; participated = true; }
			}
		}
		if (participated) { sessions++; if (record.kind === "practice") practiceSessions++; }
	}
	const dates = [...activity.keys()].sort();
	let bestStreak = 0, run = 0, previous = -Infinity;
	for (const date of dates) {
		const index = Date.parse(date + "T00:00:00Z") / DAY;
		run = index === previous + 1 ? run + 1 : 1; previous = index; bestStreak = Math.max(bestStreak, run);
	}
	// Yesterday's streak remains available until the learner's local day ends.
	let currentStreak = 0, cursor = activity.has(today) ? todayIndex : todayIndex - 1;
	while (activity.has(dateOf(cursor))) { currentStreak++; cursor--; }
	const calendar = Array.from({ length: 30 }, (_, i) => {
		const date = dateOf(todayIndex - 29 + i);
		return activity.get(date) ?? { date, activities: 0, answers: 0 };
	});
	const badge = (id: string, name: string, description: string, value: number, target: number): ProgressBadge => ({ id, name, description, value, target, unlocked: value >= target });
	const badges = [
		badge("first", "First spark", "Answer your first learning question", answers, 1),
		badge("ten", "Finding your stride", "Answer 10 learning questions", answers, 10),
		badge("fifty", "Curious mind", "Answer 50 learning questions", answers, 50),
		badge("hundred", "Century club", "Answer 100 learning questions", answers, 100),
		badge("three-days", "Building a habit", "Learn on 3 consecutive days", bestStreak, 3),
		badge("week", "A week of discovery", "Learn on 7 consecutive days", bestStreak, 7),
		badge("ideas", "Connecting the dots", "Collect 10 ideas in your knowledge graph", graph.ideas, 10),
		badge("library", "Growing a library", "Collect 100 ideas in your knowledge graph", graph.ideas, 100),
	];
	const xp = answers * ANSWER_XP;
	return { timeZone, today, xp, level: Math.floor(xp / LEVEL_XP) + 1, levelXp: xp % LEVEL_XP, nextLevelXp: LEVEL_XP,
		answers, sessions, practiceSessions, activeDays: dates.length, currentStreak, bestStreak,
		ideas: graph.ideas, connections: graph.connections, calendar, badges };
}
