"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { PaperclipIcon, XIcon, FileTextIcon } from "lucide-react";
import { MAX_ATTACHMENTS, attachmentByteLimit, formatPdfPages, parsePdfPages, type AttachmentRef } from "@/src/core";

export function AttachmentCards({ attachments, onRemove, onSelectPdf }: { attachments: AttachmentRef[]; onRemove?: (id: string) => void; onSelectPdf?: (ref: AttachmentRef) => void }) {
	return <div className="flex flex-wrap gap-2 py-2" data-testid="attachment-previews">{attachments.map(a => <div key={a.id} className="flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-border bg-background/70 p-2 text-xs">
		{a.mimeType.startsWith("image/") ?
			// eslint-disable-next-line @next/next/no-img-element
			<img src={`/api/attachments/${a.id}`} alt={a.name} className="size-14 rounded-lg object-contain" /> : <FileTextIcon className="size-6 shrink-0" />}
		<a href={`/api/attachments/${a.id}`} download={a.name} className="min-w-0 break-words underline decoration-muted-foreground/40">{a.name}{a.mimeType === "application/pdf" ? ` · ${a.pages?.length ? `pages ${formatPdfPages(a.pages)}` : `Entire PDF (${a.pageCount} pages)`}` : ""}</a>
		{onSelectPdf && a.mimeType === "application/pdf" && <button type="button" onClick={() => onSelectPdf(a)} className="rounded px-2 py-1 hover:bg-accent">Choose study pages</button>}
		{onRemove && <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)} className="shrink-0 rounded p-1 hover:bg-accent"><XIcon className="size-4" /></button>}
	</div>)}</div>;
}

export function useAttachments(imagesOnly = false) {
	const [items, setItems] = useState<AttachmentRef[]>([]);
	const itemsRef = useRef(items);
	const update = (value: AttachmentRef[]) => { itemsRef.current = value; setItems(value); };
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState("");
	const [pdf, setPdf] = useState<AttachmentRef | null>(null);
	const [pages, setPages] = useState("");
	const [scope, setScope] = useState<"all" | "pages">("all");
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	function selectPdf(ref: AttachmentRef) {
		if (controller.current) return;
		if (!itemsRef.current.some(a => a.id === ref.id) && itemsRef.current.length >= MAX_ATTACHMENTS) { setError("Choose up to four files per message."); return; }
		setPdf(ref); setScope(ref.pages ? "pages" : "all"); setPages(ref.pages ? formatPdfPages(ref.pages) : ""); setError("");
	}
	function confirmPdf() {
		if (!pdf) return;
		try {
			if (scope === "pages" && !pages.trim()) throw new Error("Enter pages such as 12-35,42.");
			const { pages: _old, ...base } = pdf;
			const ref = { ...base, ...(scope === "pages" ? { pages: parsePdfPages(pages,pdf.pageCount!) } : {}) };
			const existing = itemsRef.current.some(a => a.id === pdf.id);
			update(existing ? itemsRef.current.map(a => a.id === ref.id ? ref : a) : [...itemsRef.current,ref]);
			setPdf(null); setError("");
		} catch (e) { setError((e as Error).message); }
	}
	async function upload(file: File) {
		if (controller.current || pdf || itemsRef.current.length >= MAX_ATTACHMENTS) { setError("Finish the current attachment, and choose up to four files per message."); return; }
		const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
		if (file.size > attachmentByteLimit(isPdf ? "application/pdf" : file.type)) { setError(isPdf ? "PDFs must be 100 MB or smaller." : "Images must be 10 MB or smaller."); return; }
		const abort = new AbortController(); controller.current = abort;
		setUploading(true); setError("");
		try {
			const form = new FormData(); form.set("file",file);
			const res = await fetch("/api/attachments", { method:"POST",body:form,signal:abort.signal });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || "Could not attach file.");
			if (data.mimeType === "application/pdf") { setPdf(data); setScope("all"); setPages(""); }
			else update([...itemsRef.current,data]);
		} catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
		finally { controller.current = null; setUploading(false); }
	}
	async function addFiles(files: File[], onlyImages = imagesOnly) {
		if (files.length > 1 && files.some(f => f.type === "application/pdf" || /\.pdf$/i.test(f.name))) { setError("Attach PDFs one at a time so you can choose their pages."); return; }
		for (const file of files) {
			if (onlyImages && (file.type === "application/pdf" || /\.pdf$/i.test(file.name))) { setError("Choose an image."); continue; }
			await upload(file);
		}
	}
	return { items,itemsRef,update,uploading,error,pdf,pages,setPages,setPdf,scope,setScope,upload,addFiles,selectPdf,confirmPdf,
		clear: () => update([]), remove: (id:string) => update(itemsRef.current.filter(a => a.id !== id)),
		handlers: {
			onPaste: (e:ClipboardEvent) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void addFiles(files); } },
			onDragOver: (e:DragEvent) => { if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); },
			onDrop: (e:DragEvent) => { const files = Array.from(e.dataTransfer.files); if (files.length) { e.preventDefault(); e.stopPropagation(); void addFiles(files); } },
		},
	};
}
export type AttachmentDraft = ReturnType<typeof useAttachments>;

export function AttachmentDetails({ draft, disabled = false }: { draft:AttachmentDraft; disabled?:boolean }) {
	return <div className="px-2 text-xs">
		{draft.pdf && <fieldset disabled={disabled || draft.uploading} className="my-2 space-y-2 rounded-lg border p-3" data-testid="pdf-study-selector">
			<legend className="max-w-full break-words px-1">{draft.pdf.name} · {draft.pdf.pageCount} pages</legend>
			<label className="flex items-center gap-2"><input type="radio" checked={draft.scope === "all"} onChange={() => draft.setScope("all")} />Study entire PDF</label>
			<label className="flex items-center gap-2"><input type="radio" checked={draft.scope === "pages"} onChange={() => draft.setScope("pages")} />Choose pages</label>
			{draft.scope === "pages" && <label className="block">Pages <input aria-label="PDF pages" className="w-40 rounded border bg-background p-1" placeholder="12-35,42" value={draft.pages} onChange={e => draft.setPages(e.target.value)} /><span className="ml-2 text-muted-foreground">PDF page numbers, starting at 1</span></label>}
			<div className="flex gap-3"><button type="button" onClick={draft.confirmPdf} className="rounded bg-primary px-3 py-1.5 text-primary-foreground">Use selected scope</button><button type="button" onClick={() => draft.setPdf(null)}>Cancel</button></div>
		</fieldset>}
		{draft.items.length > 0 && <AttachmentCards attachments={draft.items} onRemove={disabled || draft.uploading ? undefined : draft.remove} onSelectPdf={disabled || draft.uploading ? undefined : draft.selectPdf} />}
		{draft.uploading && <p role="status" className="py-2 text-muted-foreground">Uploading and preparing document…</p>}
		{draft.error && <p role="alert" className="pb-2 text-destructive">{draft.error}</p>}
	</div>;
}

export function AttachmentPicker({ draft, imagesOnly = false, disabled = false, label = "Attach images or PDF", iconOnly = false }: { draft:AttachmentDraft; imagesOnly?:boolean; disabled?:boolean; label?:string; iconOnly?:boolean }) {
	const input = useRef<HTMLInputElement>(null);
	return <div className={iconOnly ? "shrink-0 text-xs" : "px-2 text-xs"} data-testid="attachment-picker">
		<button type="button" aria-label={label} title={label} disabled={disabled || draft.uploading || !!draft.pdf} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50" onClick={() => input.current?.click()}><PaperclipIcon className="size-4" />{!iconOnly && (draft.uploading ? "Preparing attachment…" : label)}</button>
		<input ref={input} type="file" className="hidden" aria-label={label} accept={imagesOnly ? "image/png,image/jpeg,image/webp" : "image/png,image/jpeg,image/webp,application/pdf"} onChange={e => { void draft.addFiles(Array.from(e.target.files ?? []),imagesOnly); e.target.value = ""; }} />
		{!iconOnly && <AttachmentDetails draft={draft} disabled={disabled} />}
	</div>;
}
