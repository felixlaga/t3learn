import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { learningProgress, validProgressTimeZone } from "../src/core/progress.ts";
import type { ChatRecord } from "../src/core/contracts/chat.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { ProgressDashboard } from "../components/progress-dialog.tsx";

const now = Date.parse("2026-10-26T15:00:00Z");
const graph = { ideas: 12, connections: 4 };
const record = (messages: LhMessage[], kind?: "practice", id = "chat_test"): ChatRecord => ({ id, title: "Private lesson", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", messages, kind });
const user = (id: string, date: string): LhMessage => ({ id, role: "user", content: "private learner text", timestamp: Date.parse(date) });
function answer(id: string, date: string, tool = "quiz", detail: Record<string, unknown> = {}): LhMessage[] {
	return [{ id: `${id}-call`, role: "assistant", content: [{ type: "toolCall", id, name: tool, arguments: {} }], timestamp: Date.parse(date) - 1000 },
		{ id: `${id}-answer`, role: "toolResult", toolCallId: id, toolName: tool, content: [{ type: "text", text: "private answer" }], isError: false,
			details: { kind: tool === "explain" || tool === "recall" ? "explain" : "quiz", questionText: "Private question", answeredAt: date, answers: [], dontKnow: true, ...detail }, timestamp: Date.parse(date) }] as LhMessage[];
}

describe("learning progress", () => {
	it("starts honestly at zero with no fabricated streak or graph mastery", () => {
		const p = learningProgress([], { ideas: 0, connections: 0 }, now, "UTC");
		assert.equal(p.level, 1); assert.equal(p.xp, 0); assert.equal(p.currentStreak, 0); assert.equal(p.bestStreak, 0);
		assert.equal(p.calendar.length, 30); assert.equal(p.calendar.at(-1)?.date, "2026-10-26");
		assert.ok(p.badges.every((b) => !b.unlocked));
	});
	it("counts each real answer once, including uncertainty and free recall; never counts skips, preferences or errors", () => {
		const messages = [
			...answer("a", "2026-10-26T10:00:00Z", "probe"),
			...answer("b", "2026-10-26T10:01:00Z", "recall", { text: "My reasoning" }),
			...answer("c", "2026-10-26T10:02:00Z", "quiz", { dismissed: true }),
			...answer("d", "2026-10-26T10:03:00Z", "ask_user_question", { kind: "ask" }),
			...answer("e", "2026-10-26T10:04:00Z"),
		];
		(messages.at(-1) as { isError: boolean }).isError = true;
		messages.push({ ...messages[1]!, id: "duplicate-result" });
		const input = record(messages, "practice"); const before = JSON.stringify(input);
		const p = learningProgress([input, input], graph, now, "UTC");
		assert.equal(p.answers, 2); assert.equal(p.xp, 40); assert.equal(p.sessions, 1); assert.equal(p.practiceSessions, 1);
		assert.equal(p.calendar.at(-1)?.activities, 2); assert.equal(p.ideas, 12); assert.equal(p.connections, 4);
		assert.equal(JSON.stringify(input), before); assert.ok(!JSON.stringify(p).includes("Private"));
	});
	it("excludes unanswered calls, invalid dates, future events and orphaned results", () => {
		const pending = answer("pending", "2026-10-26T10:00:00Z")[0]!;
		const orphan = answer("orphan", "2026-10-26T10:00:00Z")[1]!;
		const p = learningProgress([record([pending, orphan, ...answer("bad", "invalid"), ...answer("future", "2030-01-01T00:00:00Z")])], graph, now, "UTC");
		assert.equal(p.answers, 0); assert.equal(p.sessions, 0); assert.equal(p.activeDays, 0);
	});
	it("awards a new level at 200 XP and recomputes when history is removed", () => {
		const messages = Array.from({ length: 10 }, (_, i) => answer(String(i), "2026-10-26T10:00:00Z")).flat();
		const p = learningProgress([record(messages)], graph, now, "UTC");
		assert.equal(p.level, 2); assert.equal(p.xp, 200); assert.equal(p.levelXp, 0);
		assert.ok(p.badges.find((b) => b.id === "ten")?.unlocked);
		const removed = learningProgress([record(messages.slice(0, -2))], graph, now, "UTC");
		assert.equal(removed.level, 1); assert.equal(removed.levelXp, 180);
	});
	it("uses the learner's timezone across midnight rather than the server date", () => {
		const records = [record([user("1", "2026-10-24T15:01:00Z"), user("2", "2026-10-25T15:01:00Z"), user("3", "2026-10-26T15:00:00Z")])];
		const tokyo = learningProgress(records, graph, now, "Asia/Tokyo");
		assert.equal(tokyo.today, "2026-10-27"); assert.equal(tokyo.currentStreak, 3);
		assert.equal(tokyo.calendar.at(-1)?.activities, 1); assert.equal(tokyo.xp, 0);
	});
	it("keeps yesterday's streak through today, resets after a missed day, and retains the best run", () => {
		const records = [record([user("1", "2026-10-23T12:00:00Z"), user("2", "2026-10-24T12:00:00Z"), user("3", "2026-10-25T12:00:00Z")])];
		const p = learningProgress(records, graph, now, "UTC");
		assert.equal(p.currentStreak, 3); assert.equal(p.bestStreak, 3);
		const tomorrow = learningProgress(records, graph, now + 86_400_000, "UTC");
		assert.equal(tomorrow.currentStreak, 0); assert.equal(tomorrow.bestStreak, 3);
	});
	it("does not lose streak days over daylight-saving transitions", () => {
		const records = [record([user("1", "2026-03-07T17:00:00Z"), user("2", "2026-03-08T16:00:00Z"), user("3", "2026-03-09T16:00:00Z")])];
		assert.equal(learningProgress(records, graph, Date.parse("2026-03-09T18:00:00Z"), "America/New_York").currentStreak, 3);
		assert.ok(validProgressTimeZone("Asia/Tokyo")); assert.equal(validProgressTimeZone("not/a/zone"), false);
	});
	it("renders the empty and earned dashboard with accessible progress and honest labels", () => {
		for (const records of [[], [record(answer("a", "2026-10-26T10:00:00Z"))]]) {
			const p = learningProgress(records, graph, now, "UTC");
			const html = renderToStaticMarkup(<ProgressDashboard progress={p} />);
			assert.match(html, /role="progressbar"/); assert.match(html, /Questions answered/);
			assert.match(html, /Reasoning chains/); assert.match(html, /don’t measure mastery/);
			assert.equal((html.match(/role="listitem"/g) ?? []).length, 30);
			assert.ok(!html.includes("private learner text"));
		}
	});
});
