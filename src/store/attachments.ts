import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import type { AttachmentContent, AttachmentRef } from "../core/attachments.ts";

export interface StoredAttachment { ref: AttachmentRef; content: AttachmentContent }
export function attachmentDirectory(id: string): string {
	if (!/^att_[a-f0-9]{32}$/.test(id)) throw new Error("Invalid attachment ID.");
	return path.join(PATHS.data, "attachments", id);
}
export function readAttachment(id: string): StoredAttachment {
	return JSON.parse(fs.readFileSync(path.join(attachmentDirectory(id), "context.json"), "utf8")) as StoredAttachment;
}
export function attachmentContent(ids: string[]): AttachmentContent {
	return ids.flatMap(id => {
		try { return readAttachment(id).content; }
		catch { return [{ type: "text" as const, text: "[Attachment unavailable on this device. Ask the learner to attach it again; do not infer its contents.]" }]; }
	});
}
