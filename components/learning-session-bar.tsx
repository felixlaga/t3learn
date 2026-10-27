"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { useServerEvent } from "./server-events";
import type { GoalInput, LearningGoal, LearningSession } from "@/src/core";

type Detail = { context: LearningSession | null; goal: LearningGoal | null; revision: number };
export function LearningSessionBar({ chatId }: { chatId: string }) {
	const [detail, setDetail] = useState<Detail | null>(null);
	const [error, setError] = useState(""), [busy, setBusy] = useState(false);
	const load = useCallback(async () => {
		const response = await fetch(`/api/learning/session/${chatId}`, { cache: "no-store" });
		const result = await response.json();
		if (!response.ok) throw new Error(result.error ?? "Could not load the learning session.");
		return result as Detail;
	}, [chatId]);
	useEffect(() => { let live = true; setDetail(null); void load().then(d => { if (live) setDetail(d); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [load]);
	useServerEvent("turn-settled", () => { void load().then(setDetail).catch(e => setError(e.message)); });
	const context = detail?.context;
	const step = detail?.goal?.steps.find(s => s.id === context?.stepId);
	const complete = async () => {
		if (!detail?.goal || !step) return;
		setBusy(true); setError("");
		const { title, subject, outcome, priority, status, steps } = detail.goal;
		const goal: GoalInput = { title, subject, outcome, priority, status, steps: steps.map(s => s.id === step.id ? { ...s, done: true } : s) };
		try {
			const response = await fetch("/api/learning", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveGoal", revision: detail.revision, id: detail.goal.id, goal }) });
			if (!response.ok) throw new Error((await response.json()).error ?? "Could not complete the step.");
			setDetail(await load());
		} catch (e) { setError(e instanceof Error ? e.message : "Could not complete the step."); }
		finally { setBusy(false); }
	};
	return <div className="shrink-0 border-b border-border px-4 py-2 text-xs" data-testid="learning-session-bar">
		<div className="flex flex-wrap items-center justify-between gap-2"><span className="text-muted-foreground">{context ? `${context.kind === "review" ? "Selected review" : context.stepTitle ?? context.goalTitle} · about ${context.minutes} minutes` : "Choose what you want to revisit"}</span>
		<div className="flex flex-wrap items-center gap-3">
			{step && <Button size="sm" variant="ghost" disabled={busy || step.done} onClick={() => void complete()}>{step.done ? "Step completed" : "Mark step complete"}</Button>}
			<Link className="underline underline-offset-4" href={`/review?source=${chatId}`}>Keep something in review</Link>
			{context && <Link className="underline underline-offset-4" href={context.kind === "review" ? `/today?afterReview=1${context.nextGoalMinutes ? `&minutes=${context.nextGoalMinutes}` : ""}${context.nextGoalId ? `&goal=${context.nextGoalId}` : ""}` : "/today"}>{context.kind === "review" ? "Continue to main subject" : "Today"}</Link>}
		</div></div>{error && <p role="alert" className="mt-2 text-destructive">{error} <button className="underline" onClick={() => { void load().then(d => { setDetail(d); setError(""); }).catch(e => setError(e.message)); }}>Refresh</button></p>}
	</div>;
}
