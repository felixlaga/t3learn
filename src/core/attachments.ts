import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

export interface AttachmentRef {
	id: string;
	name: string;
	mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
	size: number;
	pages?: number[];
	pageCount?: number;
}
export type AttachmentContent = (TextContent | ImageContent)[];
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export function attachmentByteLimit(mimeType: string) { return mimeType === "application/pdf" ? MAX_PDF_BYTES : MAX_ATTACHMENT_BYTES; }
export function attachmentIds(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS || value.some(id => typeof id !== "string" || !/^att_[a-f0-9]{32}$/.test(id))) throw new Error("Choose up to four valid attachments.");
	return [...new Set(value as string[])];
}
export function parsePdfPages(value: string, count: number): number[] {
	if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid PDF page count.");
	if (!value.trim() || value.trim().toLowerCase() === "all") {
		return Array.from({ length: count }, (_, i) => i + 1);
	}
	const pages = new Set<number>();
	for (const segment of value.split(",")) {
		const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(segment.trim());
		if (!m) throw new Error("Use page numbers such as 1,3-5.");
		const first = Number(m[1]), last = Number(m[2] ?? m[1]);
		if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > count) throw new Error(`Choose valid pages between 1 and ${count}.`);
		for (let n = first; n <= last; n++) pages.add(n);
	}
	if (!pages.size) throw new Error("Select PDF pages.");
	return [...pages].sort((a, b) => a - b);
}

export function formatPdfPages(pages: number[]): string {
	const ranges: string[] = [];
	for (let i = 0; i < pages.length; i++) {
		const first = pages[i];
		while (i + 1 < pages.length && pages[i + 1] === pages[i]! + 1) i++;
		ranges.push(first === pages[i] ? String(first) : `${first}-${pages[i]}`);
	}
	return ranges.join(",");
}

export function parseAttachments(value: unknown): AttachmentRef[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("Invalid attachments.");
	attachmentIds(value.map(v => v?.id));
	return value.map(v => {
		if (typeof v.name !== "string" || v.name.length > 180 || !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(v.mimeType) || !Number.isSafeInteger(v.size) || v.size <= 0 || v.size > attachmentByteLimit(v.mimeType)) throw new Error("Invalid attachment metadata.");
		if (v.pages !== undefined && (!Array.isArray(v.pages) || !v.pages.length || v.pages.some((n: unknown) => !Number.isSafeInteger(n) || Number(n) < 1))) throw new Error("Invalid PDF pages.");
		return { id: v.id, name: v.name, mimeType: v.mimeType, size: v.size, ...(v.pages ? { pages: [...new Set<number>(v.pages)].sort((a,b) => a-b) } : {}), ...(Number.isSafeInteger(v.pageCount) && v.pageCount > 0 ? { pageCount: v.pageCount } : {}) };
	});
}
