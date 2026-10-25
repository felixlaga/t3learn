"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { PaperclipIcon, XIcon, FileTextIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, type AttachmentRef } from "@/src/core";

export function AttachmentCards({ attachments, onRemove }: { attachments: AttachmentRef[]; onRemove?: (id: string) => void }) {
	return <div className="flex flex-wrap gap-2 py-2" data-testid="attachment-previews">{attachments.map(a => <div key={a.id} className="flex max-w-full items-center gap-2 rounded-xl border border-border bg-background/70 p-2 text-xs">
		{a.mimeType.startsWith("image/") ? /* Original image stays available for reviewing spatial reasoning. */
			// eslint-disable-next-line @next/next/no-img-element
			<img src={`/api/attachments/${a.id}`} alt={a.name} className="size-14 rounded-lg object-contain" /> : <FileTextIcon className="size-6 shrink-0" />}
		<a href={`/api/attachments/${a.id}`} download={a.name} className="min-w-0 break-words underline decoration-muted-foreground/40">{a.name}{a.pages?.length ? ` · pages ${a.pages.join(", ")}` : ""}</a>
		{onRemove && <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)} className="shrink-0 rounded p-1 hover:bg-accent"><XIcon className="size-4" /></button>}
	</div>)}</div>;
}

export function useAttachments(imagesOnly = false) {
	const [items, setItems] = useState<AttachmentRef[]>([]);
	const itemsRef = useRef(items);
	const update = (value: AttachmentRef[]) => { itemsRef.current = value; setItems(value); };
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState("");
	const [pdf, setPdf] = useState<File | null>(null);
	const [pages, setPages] = useState("");
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	async function upload(file: File, selectedPages = "") {
		if (controller.current || itemsRef.current.length >= MAX_ATTACHMENTS) { setError("Wait for the current upload, and choose up to four files per message."); return; }
		if (file.size > MAX_ATTACHMENT_BYTES) { setError("Each file must be 10 MB or smaller."); return; }
		const abort = new AbortController(); controller.current = abort;
		setUploading(true); setError("");
		try {
			const form = new FormData(); form.set("file", file); form.set("pages", selectedPages);
			const res = await fetch("/api/attachments", { method: "POST", body: form, signal: abort.signal });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || "Could not attach file.");
			update([...itemsRef.current, data]); setPdf(null); setPages("");
		} catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
		finally { controller.current = null; setUploading(false); }
	}
	async function addFiles(files: File[], onlyImages = imagesOnly) {
		if (files.length > 1 && files.some(f => f.type === "application/pdf" || /\.pdf$/i.test(f.name))) { setError("Attach PDFs one at a time so you can choose their pages."); return; }
		for (const file of files) {
			if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
				if (onlyImages) { setError("Choose a photo or screenshot of your working."); continue; }
				setPdf(file); setPages(""); break;
			}
			await upload(file);
		}
	}
	return { items, itemsRef, update, uploading, error, pdf, pages, setPages, setPdf, upload, addFiles,
		clear: () => update([]), remove: (id: string) => update(itemsRef.current.filter(a => a.id !== id)),
		handlers: {
			onPaste: (e: ClipboardEvent) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void addFiles(files); } },
			onDragOver: (e: DragEvent) => { if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); },
			onDrop: (e: DragEvent) => { const files = Array.from(e.dataTransfer.files); if (files.length) { e.preventDefault(); void addFiles(files); } },
		},
	};
}
export type AttachmentDraft = ReturnType<typeof useAttachments>;
export function AttachmentPicker({ draft, imagesOnly = false, disabled = false, label = "Attach images or PDF" }: { draft: AttachmentDraft; imagesOnly?: boolean; disabled?: boolean; label?: string }) {
	const input = useRef<HTMLInputElement>(null);
	return <div className="px-2 text-xs" data-testid="attachment-picker">
		<button type="button" disabled={disabled || draft.uploading} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50" onClick={() => input.current?.click()}><PaperclipIcon className="size-4" />{draft.uploading ? "Preparing attachment…" : label}</button>
		<input ref={input} type="file" className="hidden" aria-label={label} accept={imagesOnly ? "image/png,image/jpeg,image/webp" : "image/png,image/jpeg,image/webp,application/pdf"} onChange={e => { void draft.addFiles(Array.from(e.target.files ?? []), imagesOnly); e.target.value = ""; }} />
		{draft.pdf && <div className="my-2 flex flex-wrap items-center gap-2 rounded-lg border p-2"><span className="break-all">{draft.pdf.name}</span><label>Pages <input aria-label="PDF pages" className="w-36 rounded border bg-background p-1" placeholder="All, or 3-5,8" value={draft.pages} onChange={e => draft.setPages(e.target.value)} /></label><span className="text-muted-foreground">Up to 10 pages</span><button type="button" disabled={draft.uploading} onClick={() => void draft.upload(draft.pdf!, draft.pages)} className="rounded bg-primary px-2 py-1 text-primary-foreground">Attach PDF</button><button type="button" disabled={draft.uploading} onClick={() => draft.setPdf(null)}>Cancel</button></div>}
		<AttachmentCards attachments={draft.items} onRemove={disabled || draft.uploading ? undefined : draft.remove} />
		{draft.error && <p role="alert" className="pb-2 text-destructive">{draft.error}</p>}
		{draft.items.length > 0 && <p className="pb-2 text-muted-foreground">Saved with this session. No automatic memory import.</p>}
	</div>;
}

export function HandwritingInput({ draft, onTranscribed, onBusyChange }: { draft: AttachmentDraft; onTranscribed: (text: string) => void; onBusyChange: (busy: boolean) => void }) {
	const params = useParams<{ id?: string }>();
	const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	useEffect(() => { onBusyChange(busy || draft.uploading); }, [busy, draft.uploading, onBusyChange]);
	async function transcribe() {
		if (busy || !draft.items.length) return;
		const abort = new AbortController(); controller.current = abort; setBusy(true); setNotice("");
		try {
			const res = await fetch("/api/attachments/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: draft.items.map(a => a.id), chatId: params?.id }), signal: abort.signal });
			const data = await res.json(); if (!res.ok) throw new Error(data.error || "Transcription failed.");
			onTranscribed(data.text); setNotice(`Draft added below — review and edit before submitting.${data.truncated ? " The transcription was cut short; check the last step." : ""}`);
		} catch (e) { if (!abort.signal.aborted) setNotice((e as Error).message); }
		finally { setBusy(false); controller.current = null; }
	}
	return <div className="border-b border-border/60 py-1">
		<AttachmentPicker draft={draft} imagesOnly disabled={busy} label="Add handwritten thinking" />
		{draft.items.length > 0 && <div className="px-3 pb-2"><button type="button" disabled={busy || draft.uploading} className="rounded-lg border px-3 py-1.5 hover:bg-accent disabled:opacity-50" onClick={() => void transcribe()}>{busy ? "Reading your working…" : "Convert to editable text"}</button><p className="mt-1 text-xs text-muted-foreground">Uses your selected image-capable model, or the Vision slot. The image is also sent with your answer.</p></div>}
		{busy && <button type="button" className="px-3 py-1 text-xs underline" onClick={() => controller.current?.abort()}>Cancel transcription</button>}
		{notice && <p role="status" className="px-3 pb-2 text-xs">{notice}</p>}
	</div>;
}
