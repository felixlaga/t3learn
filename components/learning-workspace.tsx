"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRightIcon, CalendarDaysIcon, CheckIcon, PlusIcon, RotateCcwIcon, TargetIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { TopBar } from "./top-bar";
import { useServerEvent } from "./server-events";
import { ASSESSMENT_LABELS, DIMENSION_LABELS, REVIEW_DIMENSIONS, SUBJECT_LABELS, SUBJECTS, dailyAllocation, messageAnchorId,
	type GoalInput, type LearningGoal, type LearningPayload, type LearningSubject, type GraphSnapshot, type ReviewDimension, type ReviewInput, type ReviewSchedule } from "@/src/core";

export const learningSelectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const panel = "min-w-0 [overflow-wrap:anywhere] rounded-xl border border-border bg-card/50 p-5 sm:p-6";
const help = "text-sm leading-relaxed text-muted-foreground";
export async function learningRequest<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
	const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
	const result = await response.json();
	if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
	return result;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
	return <label className="flex min-w-0 flex-col gap-2 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}
function SubjectSelect({ value, onChange }: { value: LearningSubject; onChange: (v: LearningSubject) => void }) {
	return <select className={learningSelectClass} value={value} onChange={e => onChange(e.target.value as LearningSubject)}>{SUBJECTS.map(s => <option key={s} value={s}>{SUBJECT_LABELS[s]}</option>)}</select>;
}
function DimensionSelect({ value, onChange }: { value: ReviewDimension; onChange: (v: ReviewDimension) => void }) {
	return <select className={learningSelectClass} value={value} onChange={e => onChange(e.target.value as ReviewDimension)}>{REVIEW_DIMENSIONS.map(s => <option key={s} value={s}>{DIMENSION_LABELS[s]}</option>)}</select>;
}
type Mutate = (command: Record<string, unknown>) => Promise<boolean>;
type Start = (body: Record<string, unknown>) => Promise<void>;

export function LearningWorkspace({ view, sourceChatId, initialGoalId, initialMinutes, afterReview = false }: {
	view: "today" | "goals" | "review"; sourceChatId?: string; initialGoalId?: string; initialMinutes?: number; afterReview?: boolean;
}) {
	const router = useRouter();
	const [data, setData] = useState<LearningPayload | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const refresh = useCallback(async () => {
		try { setData(await learningRequest<LearningPayload>("/api/learning")); setError(""); }
		catch (e) { setError(e instanceof Error ? e.message : "Could not load learning records."); }
	}, []);
	useEffect(() => { void refresh(); const focus = () => { void refresh(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
	useServerEvent("turn-settled", refresh);
	const mutate: Mutate = async command => {
		if (!data) return false;
		setBusy(true); setError("");
		try { setData(await learningRequest<LearningPayload>("/api/learning", { ...command, revision: data.revision }, "PATCH")); return true; }
		catch (e) { setError(e instanceof Error ? e.message : "Could not save."); return false; }
		finally { setBusy(false); }
	};
	const start: Start = async body => {
		if (!data) return;
		setBusy(true); setError("");
		try { const r = await learningRequest<{ href: string }>("/api/learning/start", { ...body, revision: data.revision }); router.push(r.href); }
		catch (e) { setError(e instanceof Error ? e.message : "Could not start the session."); setBusy(false); }
	};
	return <div className="flex h-dvh min-w-0 flex-col [&_[data-slot=button]]:max-w-full [&_[data-slot=button]]:whitespace-normal [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:min-h-9" data-testid={`learning-${view}`}>
		<TopBar><nav aria-label="Learning" className="flex min-w-0 gap-1 overflow-x-auto">{([
			["today", "Today", CalendarDaysIcon], ["goals", "Goals", TargetIcon], ["review", "Review", RotateCcwIcon],
		] as const).map(([key, label, Icon]) => <Link key={key} href={`/${key}`} aria-current={view === key ? "page" : undefined} className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm ${view === key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}><Icon className="size-4"/><span>{label}</span></Link>)}</nav></TopBar>
		<div data-testid="learning-content" className="min-h-0 min-w-0 flex-1 overflow-y-auto [overflow-wrap:anywhere]"><div className="mx-auto max-w-5xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
			{error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void refresh()}>Refresh records</Button></div>}
			{!data ? <p className={help}>{error ? "Your saved records have not been changed." : "Loading your learning…"}</p>
				: view === "today" ? <TodayPanel data={data} busy={busy} mutate={mutate} start={start} initialGoalId={initialGoalId} initialMinutes={initialMinutes} afterReview={afterReview}/>
				: view === "goals" ? <GoalsPanel data={data} busy={busy} mutate={mutate}/>
				: <ReviewPanel data={data} busy={busy} mutate={mutate} start={start} sourceChatId={sourceChatId}/>}
		</div></div>
	</div>;
}

export function TodayPanel({ data, busy, mutate, start, initialGoalId, initialMinutes, afterReview }: { data: LearningPayload; busy: boolean; mutate: Mutate; start: Start; initialGoalId?: string; initialMinutes?: number; afterReview?: boolean }) {
	const [minutes, setMinutes] = useState(initialMinutes ?? data.dailyMinutes);
	const [goalId, setGoalId] = useState(initialGoalId ?? "");
	const [reviewIds, setReviewIds] = useState<string[] | null>(afterReview ? [] : null);
	const recommendation = data.recommendations.find(r => r.goal.id === goalId) ?? data.recommendations[0];
	const candidates = data.reviews.filter(r => r.state === "due" || r.state === "untested");
	const suggested = [...candidates].sort((a, b) => Number(a.item.subject === recommendation?.goal.subject) - Number(b.item.subject === recommendation?.goal.subject)).slice(0, 2).map(r => r.item.id);
	const selected = (reviewIds ?? suggested).filter(id => candidates.some(r => r.item.id === id));
	const validMinutes = Number.isInteger(minutes) && minutes >= (afterReview ? 1 : 5) && minutes <= 240;
	const allocation = dailyAllocation(validMinutes ? minutes : data.dailyMinutes, selected.length);
	return <>
		<div className="flex flex-wrap items-end justify-between gap-5"><div><p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Your daily learning</p><h1 className="font-title text-4xl">A little recall. One deeper question.</h1><p className={`${help} mt-3`}>Choose what matters today. Your time budget is a guide, not a cutoff.</p></div><div className="w-40 max-w-full"><Field label="Minutes today"><Input type="number" min={afterReview ? 1 : 5} max={240} value={minutes || ""} onChange={e => setMinutes(Number(e.target.value))}/></Field>{minutes >= 5 && minutes !== data.dailyMinutes && <Button className="mt-2" size="sm" variant="ghost" disabled={busy || !validMinutes} onClick={() => void mutate({ action: "preferences", dailyMinutes: minutes })}>Save as default</Button>}</div></div>
		{afterReview && <p role="status" className="rounded-lg border border-border p-4 text-sm">Ready for your main subject. You can return to your review session at any time.</p>}
		<div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
			<section className={panel}><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Brief review</h2><span className="text-xs text-muted-foreground">~{allocation.reviewMinutes} min</span></div><p className={`${help} mt-2`}>Only material you chose to keep reviewing.</p>
				{!candidates.length ? <div className="my-7 space-y-3"><p className={help}>{data.reviews.length ? "Nothing is due right now. The time is yours for the main subject." : "Your review queue is empty. Add a concept, argument or capability when you want to revisit it."}</p><Link href="/review" className="text-sm underline underline-offset-4">Choose review material</Link></div> : <div className="my-5 max-h-72 space-y-2 overflow-y-auto">{candidates.map(r => <label key={r.item.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 hover:bg-accent/40"><input type="checkbox" className="mt-1 accent-current" checked={selected.includes(r.item.id)} onChange={e => setReviewIds(e.target.checked ? [...selected, r.item.id] : selected.filter(id => id !== r.item.id))}/><span className="min-w-0"><span className="block text-sm">{r.item.objective}</span><span className="mt-1 block text-xs text-muted-foreground">{SUBJECT_LABELS[r.item.subject]} · {DIMENSION_LABELS[r.item.dimension]} · {r.state === "untested" ? "First review" : "Due"}</span></span></label>)}</div>}
				<Button className="w-full" disabled={busy || !validMinutes || !selected.length} onClick={() => void start({ kind: "review", itemIds: selected, minutes: allocation.reviewMinutes, ...(recommendation ? { nextGoalId: recommendation.goal.id, nextGoalMinutes: allocation.mainMinutes } : {}) })}>Start brief review <ArrowRightIcon/></Button>
			</section>
			<section className={panel}><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Main subject</h2><span className="text-xs text-muted-foreground">~{allocation.mainMinutes} min</span></div>
				{recommendation ? <><div className="mt-4"><Field label="Learning goal"><select className={learningSelectClass} value={recommendation.goal.id} onChange={e => setGoalId(e.target.value)}>{data.recommendations.map(r => <option key={r.goal.id} value={r.goal.id}>{r.goal.title}</option>)}</select></Field></div><p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">{SUBJECT_LABELS[recommendation.goal.subject]}</p><h3 className="mt-2 font-title text-2xl">{recommendation.step?.title ?? recommendation.goal.outcome}</h3><p className={`${help} mt-3`}>{recommendation.reason}</p>
					<div className="mt-6 flex flex-wrap gap-2">{recommendation.resumeChatId ? <Button asChild><Link href={`/chat/${recommendation.resumeChatId}`}>Continue session <ArrowRightIcon/></Link></Button> : <Button disabled={busy || !validMinutes} onClick={() => void start({ kind: "goal", goalId: recommendation.goal.id, minutes: allocation.mainMinutes })}>Start main subject <ArrowRightIcon/></Button>}{recommendation.resumeChatId && <Button variant="outline" disabled={busy || !validMinutes} onClick={() => void start({ kind: "goal", goalId: recommendation.goal.id, minutes: allocation.mainMinutes })}>Start a fresh session</Button>}</div>
				</> : <div className="mt-6 space-y-4"><h3 className="font-title text-2xl">Give your learning a direction.</h3><p className={help}>Add an active goal and an outline you approve. Recommendations follow your priorities and recent progress.</p><Button asChild><Link href="/goals">Add a learning goal <PlusIcon/></Link></Button></div>}
			</section>
		</div>
		<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"><p className={help}>Something else caught your curiosity?</p><Button asChild variant="outline"><Link href="/chat/new">Explore any topic</Link></Button></div>
	</>;
}

function GoalsPanel({ data, busy, mutate }: { data: LearningPayload; busy: boolean; mutate: Mutate }) {
	const [editing, setEditing] = useState<LearningGoal | "new" | null>(null);
	return <><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="font-title text-4xl">Learning goals</h1><p className={`${help} mt-3`}>A direction and a sequence you approve. Review enrollment is always separate.</p></div><Button onClick={() => setEditing("new")}><PlusIcon/> Add goal</Button></div>
		{editing && <GoalEditor key={editing === "new" ? "new" : editing.id} goal={editing === "new" ? undefined : editing} busy={busy} onCancel={() => setEditing(null)} onSave={async goal => { if (await mutate({ action: "saveGoal", ...(editing === "new" ? {} : { id: editing.id }), goal })) setEditing(null); }}/>}
		{data.goals.length === 0 && !editing && <div className={`${panel} space-y-4`}><h2 className="font-title text-2xl">What would you like to understand?</h2><p className={help}>For example: derive the mechanics of oscillations, understand linear algebra deeply, or reason about distributed-system guarantees. Write an outline yourself or request a draft to edit.</p><Button variant="outline" onClick={() => setEditing("new")}>Create your first goal</Button></div>}
		<div className="grid gap-4 sm:grid-cols-2">{data.goals.map(goal => <section className={panel} key={goal.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">{SUBJECT_LABELS[goal.subject]} · {goal.priority} priority · {goal.status}</p><h2 className="mt-2 font-title text-2xl">{goal.title}</h2></div><Button size="sm" variant="ghost" onClick={() => setEditing(goal)}>Edit</Button></div><p className={`${help} mt-3 whitespace-pre-wrap`}>{goal.outcome}</p><ol className="mt-5 space-y-2">{goal.steps.map((step, index) => <li key={step.id} className="flex items-start gap-2 text-sm"><span className="mt-0.5 text-muted-foreground">{step.done ? <CheckIcon className="size-4"/> : `${index + 1}.`}</span><span className={step.done ? "text-muted-foreground" : ""}>{step.title}</span></li>)}</ol><p className="mt-5 text-xs text-muted-foreground">{goal.steps.filter(s => s.done).length} of {goal.steps.length} steps completed by you</p><div className="mt-4"><Button size="sm" variant="outline" asChild><Link href={`/today?goal=${goal.id}`}>Plan a session</Link></Button></div></section>)}</div>
	</>;
}

function GoalEditor({ goal, busy, onSave, onCancel }: { goal?: LearningGoal; busy: boolean; onSave: (g: GoalInput) => Promise<void>; onCancel: () => void }) {
	const [draft, setDraft] = useState<GoalInput>(() => goal ? { title: goal.title, subject: goal.subject, outcome: goal.outcome, priority: goal.priority, status: goal.status, steps: goal.steps } : { title: "", subject: "general", outcome: "", priority: "normal", status: "active", steps: [] });
	const [generating, setGenerating] = useState(false), [error, setError] = useState("");
	const propose = async () => { setGenerating(true); setError(""); try {
		const result = await learningRequest<{ steps: string[] }>("/api/learning/propose", { kind: "outline", subject: draft.subject, title: draft.title, outcome: draft.outcome });
		setDraft(d => ({ ...d, steps: result.steps.map(title => ({ id: `step_${crypto.randomUUID()}`, title, done: false })) }));
	} catch (e) { setError(e instanceof Error ? e.message : "Could not draft the outline."); } finally { setGenerating(false); } };
	return <form className={`${panel} space-y-5`} onSubmit={(e: FormEvent) => { e.preventDefault(); void onSave(draft); }}><h2 className="text-lg font-semibold">{goal ? "Edit goal" : "New goal"}</h2>
		{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
		<div className="grid gap-4 sm:grid-cols-2"><Field label="Goal title"><Input required maxLength={300} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></Field><Field label="Subject"><SubjectSelect value={draft.subject} onChange={subject => setDraft({ ...draft, subject })}/></Field></div>
		<Field label="What do you want to be able to explain or do?"><Textarea required maxLength={4000} rows={3} value={draft.outcome} onChange={e => setDraft({ ...draft, outcome: e.target.value })}/></Field>
		<div className="grid gap-4 sm:grid-cols-2"><Field label="Priority"><select className={learningSelectClass} value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as GoalInput["priority"] })}>{["high", "normal", "low"].map(p => <option key={p}>{p}</option>)}</select></Field><Field label="Status"><select className={learningSelectClass} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as GoalInput["status"] })}>{["active", "paused", "completed"].map(s => <option key={s}>{s}</option>)}</select></Field></div>
		<div><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">Your learning outline</h3><Button type="button" variant="outline" size="sm" disabled={generating || busy || !draft.title.trim() || !draft.outcome.trim()} onClick={() => void propose()}>{generating ? "Drafting…" : "Draft an outline with my model"}</Button></div><p className={`${help} mt-2`}>Edit the sequence before saving. Check a step when you decide it is complete. Drafting uses your selected model.</p>
			<div className="mt-4 space-y-2">{draft.steps.map((step, i) => <div key={step.id} className="flex items-center gap-2"><input type="checkbox" aria-label={`Step ${i + 1} complete`} checked={step.done} onChange={e => setDraft({ ...draft, steps: draft.steps.map(s => s.id === step.id ? { ...s, done: e.target.checked } : s) })}/><Input required maxLength={300} aria-label={`Step ${i + 1}`} value={step.title} onChange={e => setDraft({ ...draft, steps: draft.steps.map(s => s.id === step.id ? { ...s, title: e.target.value, done: false } : s) })}/><Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ ...draft, steps: draft.steps.filter(s => s.id !== step.id) })} aria-label={`Remove step ${i + 1}`}>Remove</Button></div>)}</div>
			<Button type="button" variant="ghost" size="sm" className="mt-3" disabled={draft.steps.length >= 40} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { id: `step_${crypto.randomUUID()}`, title: "", done: false }] })}><PlusIcon/> Add step</Button></div>
		<div className="flex gap-3"><Button type="submit" disabled={busy || generating}>Save goal and outline</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
	</form>;
}

function ReviewPanel({ data, busy, mutate, start, sourceChatId }: { data: LearningPayload; busy: boolean; mutate: Mutate; start: Start; sourceChatId?: string }) {
	const [adding, setAdding] = useState(!!sourceChatId);
	const [selected, setSelected] = useState<string[]>([]);
	return <><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="font-title text-4xl">Keep it available</h1><p className={`${help} mt-3`}>A review library you choose. Recall, reasoning and application remain distinct.</p></div><Button onClick={() => setAdding(v => !v)}><PlusIcon/> Choose material</Button></div>
		{adding && <ReviewEnrollment goals={data.goals} busy={busy} sourceChatId={sourceChatId} onEnroll={async items => { if (await mutate({ action: "enroll", items })) { setAdding(false); return true; } return false; }}/>} 
		{data.reviews.length === 0 && !adding && <section className={`${panel} space-y-4`}><h2 className="font-title text-2xl">Nothing enters automatically.</h2><p className={help}>Select material from a lesson or the knowledge map, or write a specific objective yourself. This also applies to your active learning goals.</p><Button variant="outline" onClick={() => setAdding(true)}>Choose your first review objective</Button></section>}
		{data.reviews.length > 0 && <><div className="flex flex-wrap items-center justify-between gap-3"><p className={help}>{data.reviews.filter(r => r.state === "due" || r.state === "untested").length} due or untested · {data.reviews.filter(r => r.state === "paused").length} paused</p><Button disabled={busy || !selected.length} onClick={() => void start({ kind: "review", itemIds: selected, minutes: data.dailyMinutes })}>Review selected ({selected.length})</Button></div>
		<div className="space-y-3">{data.reviews.map(review => <ReviewRow key={review.item.id} review={review} selected={selected.includes(review.item.id)} onSelect={checked => setSelected(checked ? [...selected, review.item.id] : selected.filter(id => id !== review.item.id))} busy={busy} onPause={() => { setSelected(selected.filter(id => id !== review.item.id)); void mutate({ action: "pauseReview", id: review.item.id, paused: !review.item.paused }); }} onRemove={async () => { if (await mutate({ action: "removeReview", id: review.item.id })) setSelected(selected.filter(id => id !== review.item.id)); }}/>)}</div>
		<p className="text-xs leading-relaxed text-muted-foreground">Review dates are estimates from your recorded attempts. Independent success → Good; correct with substantive hints → Hard; not yet demonstrated → Again. Skips and unassessed objectives do not change the schedule. Only the first assessed attempt per objective in a session changes timing.</p></>}
	</>;
}

export function ReviewRow({ review, selected, onSelect, busy, onPause, onRemove }: { review: ReviewSchedule; selected: boolean; onSelect: (v: boolean) => void; busy: boolean; onPause: () => void; onRemove: () => Promise<void> }) {
	const [confirming, setConfirming] = useState(false);
	const latest = review.evidence.at(-1);
	return <section className="rounded-xl border border-border p-4 sm:p-5"><div className="flex items-start gap-3"><input type="checkbox" className="mt-1.5" aria-label={`Select ${review.item.objective}`} checked={selected && !review.item.paused} disabled={review.item.paused} onChange={e => onSelect(e.target.checked)}/><div className="min-w-0 flex-1"><p className="text-xs uppercase tracking-wide text-muted-foreground">{SUBJECT_LABELS[review.item.subject]} · {review.state === "untested" ? "First review" : review.state === "due" ? "Due for review" : review.state === "paused" ? "Paused" : `Next: ${new Date(review.dueAt).toLocaleDateString()}`}</p><h2 className="mt-2 text-base font-medium">{review.item.objective}</h2><p className="mt-1 text-sm text-muted-foreground">{DIMENSION_LABELS[review.item.dimension]}</p>{latest && <p className="mt-3 text-sm">{ASSESSMENT_LABELS[latest.assessment]} <span className="text-muted-foreground">· {new Date(latest.at).toLocaleDateString()}</span></p>}
			<div className="mt-3 flex flex-wrap items-center gap-3">{review.item.source.chatId && <Link className="text-xs underline underline-offset-4" href={`/chat/${review.item.source.chatId}`}>Source lesson</Link>}{review.item.source.label && <span className="text-xs text-muted-foreground">{review.item.source.label}</span>}<Button size="sm" variant="ghost" disabled={busy} onClick={onPause}>{review.item.paused ? "Resume review" : "Pause"}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(v => !v)}>Remove</Button></div>
			{confirming && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm"><span>Remove from review? The source lesson stays.</span><Button size="sm" variant="destructive" disabled={busy} onClick={() => void onRemove()}>Remove from review</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button></div>}
			{review.evidence.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Evidence ({review.evidence.length} attempts)</summary><div className="mt-3 space-y-4">{[...review.evidence].reverse().map(e => <div key={`${e.chatId}:${e.callId}:${e.itemId}`} className="border-l-2 border-border pl-3"><p className="font-medium">{ASSESSMENT_LABELS[e.assessment]}</p><p className="mt-1 text-muted-foreground">{e.reason}</p><p className="mt-1 text-xs text-muted-foreground">{e.problem}</p><Link className="mt-2 inline-block text-xs underline underline-offset-4" href={`/chat/${e.chatId}#${messageAnchorId(e.callId)}`}>Open attempt · {new Date(e.at).toLocaleString()}</Link></div>)}</div></details>}
		</div></div></section>;
}

function ReviewEnrollment({ goals, busy, sourceChatId, onEnroll }: { goals: LearningGoal[]; busy: boolean; sourceChatId?: string; onEnroll: (items: ReviewInput[]) => Promise<boolean> }) {
	const [subject, setSubject] = useState<LearningSubject>("general"), [dimension, setDimension] = useState<ReviewDimension>("explain");
	const [objective, setObjective] = useState(""), [goalId, setGoalId] = useState("");
	const [chatId, setChatId] = useState(sourceChatId ?? ""), [nodeIds, setNodeIds] = useState<string[]>([]), [sourceLabel, setSourceLabel] = useState("");
	const [chats, setChats] = useState<Array<{ id: string; title: string }>>([]), [graph, setGraph] = useState<GraphSnapshot | null>(null);
	const [error, setError] = useState(""), [generating, setGenerating] = useState(false);
	const [proposals, setProposals] = useState<Array<{ objective: string; dimension: ReviewDimension; checked: boolean }>>([]);
	useEffect(() => { let live = true; void Promise.all([learningRequest<{ chats: Array<{ id: string; title: string }> }>("/api/chats"), learningRequest<GraphSnapshot>("/api/graph")]).then(([c, g]) => { if (live) { setChats(c.chats); setGraph(g); } }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
	const source = () => ({ ...(chatId ? { chatId } : {}), nodeIds, label: sourceLabel || chats.find(c => c.id === chatId)?.title || "Personal learning objective" });
	const asInput = (o: string, d: ReviewDimension): ReviewInput => ({ objective: o, dimension: d, subject, ...(goalId ? { goalId } : {}), source: source() });
	const propose = async () => { setGenerating(true); setError(""); try { const result = await learningRequest<{ items: Array<{ objective: string; dimension: ReviewDimension }> }>("/api/learning/propose", { kind: "review", subject, chatId }); setNodeIds([]); setSourceLabel(""); setProposals(result.items.map(i => ({ ...i, checked: false }))); } catch (e) { setError(e instanceof Error ? e.message : "Could not suggest review objectives."); } finally { setGenerating(false); } };
	return <fieldset disabled={generating || busy} className={`${panel} space-y-5`}><h2 className="text-lg font-semibold">Choose what to keep reviewing</h2><p className={help}>Saving a goal, finishing a lesson or importing notes never adds review items. Only the buttons here enroll your selection.</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
		<div className="grid gap-4 sm:grid-cols-2"><Field label="Subject"><SubjectSelect value={subject} onChange={s => { setSubject(s); setProposals([]); }}/></Field><Field label="Related goal (optional)"><select className={learningSelectClass} value={goalId} onChange={e => { setGoalId(e.target.value); setProposals([]); const goal = goals.find(g => g.id === e.target.value); if (goal) setSubject(goal.subject); }}><option value="">No goal</option>{goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select></Field></div>
		<div className="grid gap-4 sm:grid-cols-2"><Field label="Source lesson (optional)"><select className={learningSelectClass} value={chatId} onChange={e => { setChatId(e.target.value); setProposals([]); }}><option value="">Choose a lesson</option>{chats.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field><Field label="Source concept or chain (optional)"><select className={learningSelectClass} defaultValue="" onChange={e => { setProposals([]); const node = graph?.propositions.find(n => n.id === e.target.value); const chain = graph?.chains.find(c => c.id === e.target.value); if (node) { setObjective(node.statement); setNodeIds([node.id]); setSourceLabel(node.name); } else if (chain && graph) { const ids = [...chain.premises, chain.conclusion]; const text = ids.map(id => graph.propositions.find(n => n.id === id)?.statement ?? id); setObjective(`${text.slice(0, -1).join("; ")} ⇒ ${text.at(-1)}`); setNodeIds(ids); setSourceLabel("Selected reasoning chain"); } else { setNodeIds([]); setSourceLabel(""); } }}><option value="">Choose from the knowledge map</option>{graph?.propositions.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}{graph?.chains.map(c => <option key={c.id} value={c.id}>Chain: {graph.propositions.find(n => n.id === c.conclusion)?.name ?? c.conclusion}</option>)}</select></Field></div>
		{chatId && <div><Button variant="outline" disabled={generating || busy} onClick={() => void propose()}>{generating ? "Reading the lesson…" : "Suggest objectives from this lesson"}</Button><p className="mt-2 text-xs text-muted-foreground">Uses the selected model. Suggestions remain unchecked until you choose them.</p></div>}
		{proposals.length > 0 && <div className="space-y-3 rounded-lg border border-border p-4"><h3 className="font-medium">Suggested objectives — not enrolled</h3>{proposals.map((p, i) => <div key={i} className="flex items-start gap-3"><input type="checkbox" className="mt-3" aria-label={`Keep suggestion ${i + 1}`} checked={p.checked} onChange={e => setProposals(proposals.map((v, j) => i === j ? { ...v, checked: e.target.checked } : v))}/><div className="flex-1 space-y-2"><Textarea aria-label={`Suggested objective ${i + 1}`} maxLength={2000} value={p.objective} onChange={e => setProposals(proposals.map((v, j) => i === j ? { ...v, objective: e.target.value } : v))}/><DimensionSelect value={p.dimension} onChange={d => setProposals(proposals.map((v, j) => i === j ? { ...v, dimension: d } : v))}/></div></div>)}<Button disabled={busy || !proposals.some(p => p.checked)} onClick={() => void onEnroll(proposals.filter(p => p.checked).map(p => asInput(p.objective, p.dimension)))}>Add selected objectives to review</Button></div>}
		<form className="space-y-4 border-t border-border pt-5" onSubmit={e => { e.preventDefault(); void onEnroll([asInput(objective, dimension)]); }}><Field label="Specific objective"><Textarea required maxLength={2000} rows={3} placeholder="What should you be able to reconstruct, explain or reason through?" value={objective} onChange={e => setObjective(e.target.value)}/></Field><Field label="Capability to review"><DimensionSelect value={dimension} onChange={setDimension}/></Field><Button disabled={busy || !objective.trim()} type="submit">Keep this objective in review</Button></form>
	</fieldset>;
}
