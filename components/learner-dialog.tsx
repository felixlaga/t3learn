"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon, TreeDeciduousIcon, XIcon } from "lucide-react";
import { ASPECT_LABELS, GENERAL_ASPECTS, GENERAL_BRANCH, SUBJECT_ASPECTS, type LearnerAspect, type SubjectBranch } from "@/src/core";
import { useServerEvent, useServerResync } from "./server-events";
import { Hint } from "@/components/ui/hint";
import { FOOTER_ICON_CLASS } from "@/components/footer-icon";

/**
 * "How I learn" (owner, 2026-10-30): the learner tree, shown to the
 * learner. Two branches: General (background, skills, struggles) and one
 * branch per subject (how to ask him questions, how to explain things to
 * him). Notes in use shape every lesson; notes seen once wait for a
 * second sign. He can add, edit and forget notes; what he writes is in
 * use at once and the background reader never changes it.
 *
 * Wire shape mirrors src/server/learner.ts LearnerView (the shell may
 * only import the core barrel, so it is restated here as a type).
 */
interface ViewNote {
	id: string; branchId: string; aspect: LearnerAspect; text: string;
	status: "observed" | "active"; origin: "said" | "noticed" | "written";
	updatedAt: string; quotes: string[]; lessons: Array<{ chatId: string; title: string }>; sightings: number;
}
interface View { revision: number; subjects: SubjectBranch[]; notes: ViewNote[] }

export function LearnerButton() {
	return <Dialog.Root>
		{/* Same order law as ProgressButton: the tooltip wraps the trigger. */}
		<Hint label="How I learn" side="top">
			<Dialog.Trigger asChild>
				<button type="button" data-testid="learner-entry" aria-label="How I learn" className={FOOTER_ICON_CLASS}>
					<TreeDeciduousIcon aria-hidden className="size-4" />
				</button>
			</Dialog.Trigger>
		</Hint>
		<Dialog.Portal>
			<Dialog.Overlay className="fixed inset-0 z-50 bg-black/65" />
			<Dialog.Content data-testid="learner-dialog" className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[min(820px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-border bg-background font-sans shadow-2xl focus:outline-none">
				<div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5 sm:px-8">
					<div>
						<Dialog.Title className="text-xl font-semibold tracking-tight">How I learn</Dialog.Title>
						<Dialog.Description className="mt-1 text-sm text-muted-foreground">What your teacher knows about how you learn. Notes in use shape every lesson.</Dialog.Description>
					</div>
					<Dialog.Close aria-label="Close" className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"><XIcon aria-hidden className="size-5" /></Dialog.Close>
				</div>
				<LearnerPanel />
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>;
}

function LearnerPanel() {
	const [view, setView] = useState<View | null>(null);
	const [error, setError] = useState<string | null>(null);
	const request = useRef<AbortController | null>(null);
	const refresh = useCallback(async () => {
		request.current?.abort();
		const controller = new AbortController(); request.current = controller;
		try {
			const response = await fetch("/api/learner", { cache: "no-store", signal: controller.signal });
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not read your learning tree.");
			const value = await response.json() as View;
			if (!controller.signal.aborted) { setView(value); setError(null); }
		} catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not read your learning tree."); }
	}, []);
	useEffect(() => { void refresh(); return () => request.current?.abort(); }, [refresh]);
	useServerEvent("learner-changed", () => void refresh());
	useServerResync(() => void refresh());

	const change = useCallback(async (body: Record<string, unknown>) => {
		const response = await fetch("/api/learner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		const value = await response.json().catch(() => null);
		if (!response.ok) { setError(value?.error ?? "That change did not save."); return false; }
		setView(value as View); setError(null); return true;
	}, []);

	return <div className="min-h-0 overflow-y-auto px-6 py-6 sm:px-8" data-testid="learner-scroll">
		{error && <div role="alert" className="mb-4 rounded-xl border border-border p-4 text-sm">{error} <button className="underline underline-offset-4" onClick={() => void refresh()}>Try again</button></div>}
		{view ? <LearnerTree view={view} change={change} /> : !error && <p role="status" className="py-14 text-center text-muted-foreground">Reading your tree…</p>}
	</div>;
}

type Change = (body: Record<string, unknown>) => Promise<boolean>;

/** Pure rendering seam over one view. */
export function LearnerTree({ view, change }: { view: View; change: Change }) {
	const [subjectName, setSubjectName] = useState("");
	const notesFor = (branchId: string, aspect: LearnerAspect) => view.notes.filter((n) => n.branchId === branchId && n.aspect === aspect);
	return <div className="space-y-6" data-testid="learner-tree">
		<p className="text-sm leading-relaxed text-muted-foreground">
			Your teacher saves a note when you say how you want to be taught. A reader also looks for patterns in your answers. A pattern it sees once waits. It is used only after it shows up a second time. Anything you write here is used at once.
		</p>
		<section aria-label="General" className="rounded-2xl border border-border bg-card/50 p-5">
			<h2 className="text-base font-semibold">General</h2>
			<p className="mt-1 text-xs text-muted-foreground">True in every subject.</p>
			<div className="mt-4 space-y-5">
				{GENERAL_ASPECTS.map((aspect) => <AspectGroup key={aspect} branchId={GENERAL_BRANCH} aspect={aspect} notes={notesFor(GENERAL_BRANCH, aspect)} change={change} />)}
			</div>
		</section>
		<section aria-label="Subjects" className="space-y-4">
			<h2 className="text-base font-semibold">Subjects</h2>
			{view.subjects.length === 0 && <p className="text-sm text-muted-foreground">No subjects yet. They appear as you study, or add one below.</p>}
			{view.subjects.map((subject) => <div key={subject.id} className="rounded-2xl border border-border bg-card/50 p-5" data-testid={`learner-subject-${subject.id}`}>
				<h3 className="text-base font-semibold">{subject.name}</h3>
				{subject.description && <p className="mt-1 text-xs text-muted-foreground">{subject.description}</p>}
				<div className="mt-4 space-y-5">
					{SUBJECT_ASPECTS.map((aspect) => <AspectGroup key={aspect} branchId={subject.id} aspect={aspect} notes={notesFor(subject.id, aspect)} change={change} />)}
				</div>
			</div>)}
			<form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const name = subjectName.trim(); if (name) void change({ action: "addSubject", name }).then((ok) => ok && setSubjectName("")); }}>
				<input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} maxLength={60} placeholder="Add a subject, like Philosophy" aria-label="New subject name" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
				<button type="submit" disabled={!subjectName.trim()} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50">Add subject</button>
			</form>
		</section>
	</div>;
}

function AspectGroup({ branchId, aspect, notes, change }: { branchId: string; aspect: LearnerAspect; notes: ViewNote[]; change: Change }) {
	const [adding, setAdding] = useState(false);
	const [draft, setDraft] = useState("");
	return <div>
		<div className="flex items-center justify-between gap-2">
			<h4 className="text-sm font-medium">{ASPECT_LABELS[aspect]}</h4>
			{!adding && <button type="button" onClick={() => setAdding(true)} aria-label={`Add to ${ASPECT_LABELS[aspect]}`} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"><PlusIcon aria-hidden className="size-3.5" />Add</button>}
		</div>
		<ul className="mt-2 space-y-2">
			{notes.map((note) => <NoteRow key={note.id} note={note} change={change} />)}
			{notes.length === 0 && !adding && <li className="text-xs text-muted-foreground">Nothing yet.</li>}
		</ul>
		{adding && <NoteEditor initial="" onCancel={() => { setAdding(false); setDraft(""); }} draft={draft} setDraft={setDraft}
			onSave={async (text) => { if (await change({ action: "add", branchId, aspect, text })) { setAdding(false); setDraft(""); } }} />}
	</div>;
}

function statusLine(note: ViewNote): string {
	if (note.status === "observed") return "Seen once. Waits for a second sign before it is used.";
	if (note.origin === "said") return "In use. You said this in a lesson.";
	if (note.origin === "written") return "In use. You wrote this.";
	return `In use. Seen in ${note.sightings} of your answers.`;
}

function NoteRow({ note, change }: { note: ViewNote; change: Change }) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(note.text);
	const [confirming, setConfirming] = useState(false);
	if (editing) return <li><NoteEditor initial={note.text} draft={draft} setDraft={setDraft} onCancel={() => { setEditing(false); setDraft(note.text); }}
		onSave={async (text) => { if (await change({ action: "edit", noteId: note.id, text })) setEditing(false); }} /></li>;
	return <li data-testid={`learner-note-${note.id}`} data-status={note.status} className={`group rounded-xl border p-3 ${note.status === "active" ? "border-border bg-background" : "border-dashed border-border bg-transparent"}`}>
		<div className="flex items-start gap-3">
			<p className={`min-w-0 flex-1 text-sm leading-relaxed ${note.status === "active" ? "" : "text-muted-foreground"}`}>{note.text}</p>
			<div className="flex shrink-0 gap-1">
				<button type="button" onClick={() => { setDraft(note.text); setEditing(true); }} aria-label="Edit note" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><PencilIcon aria-hidden className="size-3.5" /></button>
				<button type="button" onClick={() => setConfirming(true)} aria-label="Forget note" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Trash2Icon aria-hidden className="size-3.5" /></button>
			</div>
		</div>
		<p className="mt-1.5 text-xs text-muted-foreground">{statusLine(note)}</p>
		{note.quotes.length > 0 && <p className="mt-1 text-xs italic text-muted-foreground">“{note.quotes.at(-1)}”</p>}
		{note.lessons.length > 0 && <p className="mt-1 text-xs text-muted-foreground">From: {note.lessons.map((l) => l.title).join(", ")}</p>}
		{confirming && <div role="alertdialog" aria-label="Forget this note?" className="mt-2 flex items-center gap-2 text-xs">
			<span>Forget this note? The reader will not learn it again.</span>
			<button type="button" onClick={() => void change({ action: "forget", noteId: note.id })} className="rounded-md border border-border px-2 py-1 hover:bg-accent">Forget</button>
			<button type="button" onClick={() => setConfirming(false)} className="rounded-md px-2 py-1 hover:bg-accent">Keep</button>
		</div>}
	</li>;
}

function NoteEditor({ initial, draft, setDraft, onSave, onCancel }: { initial: string; draft: string; setDraft: (v: string) => void; onSave: (text: string) => Promise<void>; onCancel: () => void }) {
	const [saving, setSaving] = useState(false);
	const text = draft.trim();
	return <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); if (!text || text === initial) return; setSaving(true); void onSave(text).finally(() => setSaving(false)); }}>
		<textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={400} rows={2} placeholder="One plain instruction, like: Show every algebra step." aria-label="Note text" className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm" />
		<div className="flex gap-2">
			<button type="submit" disabled={saving || !text || text === initial} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"><CheckIcon aria-hidden className="size-3.5" />Save</button>
			<button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs hover:bg-accent">Cancel</button>
		</div>
	</form>;
}
