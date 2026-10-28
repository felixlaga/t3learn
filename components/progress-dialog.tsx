"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { AwardIcon, BookOpenIcon, CheckIcon, FlameIcon, GitBranchIcon, SparklesIcon, TrophyIcon, XIcon } from "lucide-react";
import { ANSWER_XP, type LearningProgress } from "@/src/core";
import { useServerEvent, useServerResync } from "./server-events";
import { Hint } from "@/components/ui/hint";
import { FOOTER_ICON_CLASS } from "@/components/footer-icon";

const number = (value: number) => value.toLocaleString();

export function ProgressButton() {
	return <Dialog.Root>
		<Dialog.Trigger asChild>
			{/* Icon-only since the T3 Code row (owner, 2026-10-28); the trophy
			    keeps its amber (the owner's earlier choice), the label rides
			    the tooltip and the accessible name. */}
			<Hint label="Progress" side="top">
				<button type="button" data-testid="progress-entry" aria-label="Progress" className={FOOTER_ICON_CLASS}>
					<TrophyIcon aria-hidden className="size-4 text-amber-400" />
				</button>
			</Hint>
		</Dialog.Trigger>
		<Dialog.Portal>
			<Dialog.Overlay className="fixed inset-0 z-50 bg-black/65" />
			<Dialog.Content data-testid="progress-dialog" className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[min(920px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-border bg-background font-sans shadow-2xl focus:outline-none">
				<div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5 sm:px-8">
					<div><Dialog.Title className="text-xl font-semibold tracking-tight">Your learning journey</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted-foreground">Small steps. A growing world of ideas.</Dialog.Description></div>
					<Dialog.Close aria-label="Close progress" className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"><XIcon aria-hidden className="size-5" /></Dialog.Close>
				</div>
				<ProgressPanel />
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>;
}

function ProgressPanel() {
	const [progress, setProgress] = useState<LearningProgress | null>(null);
	const [error, setError] = useState(false);
	const request = useRef<AbortController | null>(null);
	const refresh = useCallback(async () => {
		request.current?.abort();
		const controller = new AbortController(); request.current = controller;
		try {
			const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
			const response = await fetch(`/api/progress?timeZone=${encodeURIComponent(timeZone)}`, { cache: "no-store", signal: controller.signal });
			if (!response.ok) throw new Error("Progress unavailable");
			const value = await response.json() as LearningProgress;
			if (!controller.signal.aborted) { setProgress(value); setError(false); }
		} catch { if (!controller.signal.aborted) setError(true); }
	}, []);
	useEffect(() => {
		void refresh();
		// Handles midnight and a graph extraction finishing while this view stays open.
		const timer = setInterval(() => void refresh(), 60_000);
		const focus = () => void refresh(); window.addEventListener("focus", focus);
		return () => { clearInterval(timer); window.removeEventListener("focus", focus); request.current?.abort(); };
	}, [refresh]);
	useServerEvent("turn-settled", () => void refresh());
	useServerEvent("chats-changed", () => void refresh());
	useServerEvent("record-changed", () => void refresh());
	useServerEvent("activity-changed", () => void refresh());
	useServerResync(() => void refresh());
	return <div className="min-h-0 overflow-y-auto px-6 py-6 sm:px-8" data-testid="progress-scroll">
		{error && <div role="alert" className="mb-4 rounded-xl border border-border p-4 text-sm">Could not refresh your progress. <button className="underline underline-offset-4" onClick={() => void refresh()}>Try again</button></div>}
		{progress ? <ProgressDashboard progress={progress} /> : !error && <p role="status" className="py-14 text-center text-muted-foreground">Gathering your journey…</p>}
	</div>;
}

/** Pure rendering seam; all counts come from the same server aggregate. */
export function ProgressDashboard({ progress: p }: { progress: LearningProgress }) {
	const unlocked = p.badges.filter((b) => b.unlocked).length;
	const remaining = Math.ceil((p.nextLevelXp - p.levelXp) / ANSWER_XP);
	const firstWeekday = new Date(`${p.calendar[0]!.date}T12:00:00Z`).getUTCDay();
	return <div className="space-y-6" data-testid="progress-dashboard">
		<section className="relative overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-400/10 via-card to-card p-5 sm:p-6" aria-label="Experience and level">
			<div className="flex items-start justify-between gap-5">
				<div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400">Keep your curiosity going</p><h2 className="mt-2 text-3xl font-semibold tracking-tight" data-testid="progress-level">Level {number(p.level)}</h2><p className="mt-2 text-sm text-muted-foreground">{p.answers === 0 ? "Your first answer starts the adventure." : `${number(remaining)} more ${remaining === 1 ? "answer" : "answers"} to your next level.`}</p></div>
				<div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-amber-400/25 bg-amber-400/10"><TrophyIcon aria-hidden className="size-8 text-amber-400" /></div>
			</div>
			<div className="mb-2 mt-6 flex items-center justify-between gap-2 text-sm"><span className="font-semibold text-amber-400" data-testid="progress-xp">{number(p.xp)} XP</span><span className="text-muted-foreground">{number(p.levelXp)} / {number(p.nextLevelXp)} XP this level</span></div>
			<div role="progressbar" aria-label="Progress to next level" aria-valuenow={p.levelXp} aria-valuemin={0} aria-valuemax={p.nextLevelXp} className="h-2.5 overflow-hidden rounded-full bg-amber-400/10"><div className="h-full rounded-full bg-amber-400 transition-[width] motion-reduce:transition-none" style={{ width: `${p.levelXp / p.nextLevelXp * 100}%` }} /></div>
			<p className="mt-3 text-xs leading-relaxed text-muted-foreground">20 XP for each answered learning question, including “I don’t know.” Skipped questions don’t count. Levels celebrate participation.</p>
		</section>
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<Stat label="Day streak" value={p.currentStreak} detail={`Best: ${number(p.bestStreak)} ${p.bestStreak === 1 ? "day" : "days"}`} icon={<FlameIcon aria-hidden className="size-4 text-orange-400" />} />
			<Stat label="Questions answered" value={p.answers} detail="Every honest attempt counts" icon={<CheckIcon aria-hidden className="size-4 text-emerald-400" />} />
			<Stat label="Sessions explored" value={p.sessions} detail={`${number(p.practiceSessions)} practice sessions`} icon={<BookOpenIcon aria-hidden className="size-4 text-sky-400" />} />
			<Stat label="Active days" value={p.activeDays} detail="Across your saved history" icon={<SparklesIcon aria-hidden className="size-4 text-violet-400" />} />
		</div>
		<div className="grid gap-4 sm:grid-cols-[1.1fr_1fr]">
			<section className="rounded-2xl border border-border bg-card/50 p-5" aria-label="30-day activity">
				<div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">Showing up</h2><span className="text-xs text-muted-foreground">Last 30 days</span></div>
				<div className="grid grid-cols-7 gap-1.5" role="list" aria-label="Daily learning activity">
					{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`label-${index}`} aria-hidden className="pb-1 text-center text-xs text-muted-foreground">{day}</span>)}
					{Array.from({ length: firstWeekday }, (_, i) => <span key={`empty-${i}`} aria-hidden />)}
					{p.calendar.map((day) => <div key={day.date} role="listitem" tabIndex={0} title={`${day.date}: ${day.activities} activities, ${day.answers} answers`} aria-label={`${day.date}: ${day.activities} activities, ${day.answers} answers${day.date === p.today ? ", today" : ""}`} className={`flex aspect-square max-h-10 items-center justify-center rounded-md text-xs tabular-nums outline-offset-2 ${day.activities === 0 ? "bg-muted/60 text-muted-foreground" : day.answers >= 5 ? "bg-emerald-400 text-emerald-950" : "bg-emerald-400/20 text-emerald-300"} ${day.date === p.today ? "ring-1 ring-foreground/50" : ""}`}>{Number(day.date.slice(-2))}</div>)}
				</div>
				<p className="mt-4 text-xs leading-relaxed text-muted-foreground">A message, practice step, or answered question makes an active day. Dates use {p.timeZone}. Yesterday’s streak stays alive until today ends.</p>
			</section>
			<section className="flex flex-col rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-400/5 to-card p-5" aria-label="Knowledge graph statistics">
				<div className="flex items-center gap-2"><GitBranchIcon aria-hidden className="size-4 text-violet-400" /><h2 className="text-base font-semibold">Your growing knowledge map</h2></div>
				<div className="my-6 grid grid-cols-2 gap-4"><div><p className="text-3xl font-semibold tabular-nums">{number(p.ideas)}</p><p className="mt-1 text-sm text-muted-foreground">Ideas collected</p></div><div><p className="text-3xl font-semibold tabular-nums">{number(p.connections)}</p><p className="mt-1 text-sm text-muted-foreground">Reasoning chains</p></div></div>
				<p className="mt-auto text-xs leading-relaxed text-muted-foreground">Extracted from lessons and imported notes. These counts describe your map; they don’t measure mastery. New ideas appear when extraction finishes.</p>
			</section>
		</div>
		<section aria-label="Milestone badges">
			<div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Milestones</h2><span className="text-xs text-muted-foreground">{unlocked} / {p.badges.length} unlocked</span></div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{p.badges.map((badge) => <div key={badge.id} data-unlocked={badge.unlocked} className={`flex items-center gap-3 rounded-xl border p-3.5 ${badge.unlocked ? "border-amber-400/25 bg-amber-400/5" : "border-border bg-card/40"}`}>
					<div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${badge.unlocked ? "bg-amber-400/15 text-amber-400" : "bg-muted text-muted-foreground"}`}><AwardIcon aria-hidden className="size-5" /></div>
					<div className="min-w-0 flex-1"><p className="text-sm font-semibold">{badge.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{badge.description}</p><p className={`mt-1 text-xs ${badge.unlocked ? "text-amber-400" : "text-muted-foreground"}`}>{badge.unlocked ? "Unlocked" : `${number(Math.min(badge.value, badge.target))} / ${number(badge.target)}`}</p></div>
				</div>)}
			</div>
		</section>
		<p className="pb-1 text-xs leading-relaxed text-muted-foreground">Built from your saved learning history. Deleting sessions can lower XP and activity totals. Teaching, quizzes, and grading work exactly as before.</p>
	</div>;
}

function Stat({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: React.ReactNode }) {
	return <section className="rounded-2xl border border-border bg-card/50 p-4"><div className="flex items-center gap-2">{icon}<h2 className="text-xs text-muted-foreground">{label}</h2></div><p className="mt-3 text-2xl font-semibold tabular-nums">{number(value)}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></section>;
}
