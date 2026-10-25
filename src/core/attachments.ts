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
export function attachmentIds(value: unknown): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS || value.some(id => typeof id !== "string" || !/^att_[a-f0-9]{32}$/.test(id))) throw new Error("Choose up to four valid attachments.");
	return [...new Set(value as string[])];
}
export function parsePdfPages(value: string, count: number): number[] {
	if (!value.trim()) {
		if (count > 10) throw new Error(`This PDF has ${count} pages. Select up to 10 pages, for example 3-5.`);
		return Array.from({ length: count }, (_, i) => i + 1);
	}
	const pages = new Set<number>();
	for (const segment of value.split(",")) {
		const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(segment.trim());
		if (!m) throw new Error("Use page numbers such as 1,3-5.");
		const first = Number(m[1]), last = Number(m[2] ?? m[1]);
		if (first < 1 || last < first || last > count || last - first > 9) throw new Error(`Choose valid pages between 1 and ${count}, up to 10 at a time.`);
		for (let n = first; n <= last; n++) pages.add(n);
	}
	if (!pages.size || pages.size > 10) throw new Error("Select up to 10 PDF pages.");
	return [...pages].sort((a, b) => a - b);
}

export function parseAttachments(value: unknown): AttachmentRef[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("Invalid attachments.");
	attachmentIds(value.map(v => v?.id));
	return value.map(v => {
		if (typeof v.name !== "string" || v.name.length > 180 || !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(v.mimeType) || typeof v.size !== "number" || v.size <= 0 || v.size > MAX_ATTACHMENT_BYTES) throw new Error("Invalid attachment metadata.");
		return { id: v.id, name: v.name, mimeType: v.mimeType, size: v.size, ...(Array.isArray(v.pages) ? { pages: v.pages.filter((n: unknown) => Number.isInteger(n) && Number(n) > 0).slice(0, 10) } : {}), ...(Number.isInteger(v.pageCount) ? { pageCount: v.pageCount } : {}) };
	});
}
