import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parsePdfPages, attachmentIds, parseAttachments } from "../src/core/attachments.ts";
import { inputAppends, parseChatInput } from "../src/core/input-events.ts";
import { newAttachmentMessage, nativeInputCause, toLlmMessages } from "../src/core/native-messages.ts";
import { messageViewLines } from "../src/core/coverage.ts";
import { projectView } from "../src/core/view.ts";
import { normalizeContext } from "@earendil-works/pi-ai";
import { cliContext } from "../src/agent/cli-stream.ts";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "t3learn-attachments-test-"));
process.env.LH_DATA_DIR = root;
const { prepareAttachment, uploadAttachment, downloadAttachment } = await import("../src/server/attachments.ts");
const { readAttachment, attachmentContent, attachmentDirectory } = await import("../src/store/attachments.ts");
after(() => fs.rm(root, { recursive: true, force: true }));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");

test("PDF selection is bounded, explicit for long files, and never silently reads omitted pages", () => {
	assert.deepEqual(parsePdfPages("", 3), [1,2,3]);
	assert.deepEqual(parsePdfPages("3,1-2,2", 20), [1,2,3]);
	for (const [value, count] of [["",11],["0",3],["4",3],["3-2",3],["1-1000000",1000000],["garbage",3]] as const) assert.throws(() => parsePdfPages(value,count));
	assert.throws(() => attachmentIds(["../../auth.json"]));
	assert.throws(() => attachmentIds(Array(5).fill("att_" + "a".repeat(32))));
});

test("image upload validates bytes, saves separate files, previews original, and hydrates native vision content", async () => {
	const ref = await prepareAttachment(new File([png], "working.png", { type: "image/png" }));
	const stored = readAttachment(ref.id);
	assert.equal(stored.content.filter(p => p.type === "image").length, 1);
	assert.ok(stored.content.some(p => p.type === "image" && p.data.length > 20));
	const download = await downloadAttachment(ref.id);
	assert.equal(download.status,200); assert.equal(download.headers.get("content-type"),"image/png");
	assert.deepEqual(Buffer.from(await download.arrayBuffer()),png);
	const event = parseChatInput({ type: "text", text: "Explain my diagram", attachments: [ref] });
	const messages = inputAppends({ messages: [] },event);
	const marker = messages[1]!;
	assert.deepEqual(messageViewLines(marker,marker.id),[]);
	assert.equal(nativeInputCause(marker,[]),"neutral");
	assert.equal(JSON.stringify(messages).includes(stored.content.find(p => p.type === "image")!.data), false, "binary data must not bloat chat JSON or Git backups");
	const projected = projectView(messages);
	assert.ok(projected.some(m => m.parts.some(p => p.type === "data-session-attachments")));
	const wire = toLlmMessages(messages,attachmentContent);
	const cli = cliContext(normalizeContext({ messages: wire, tools: [] }));
	assert.equal(cli.images.length,1); assert.match(cli.prompt,/Explain my diagram/);
	assert.ok(wire.some(m => m.role === "user" && Array.isArray(m.content) && m.content.some(p => p.type === "image")));
});

test("selected PDF pages include both readable text and rendered page images", async () => {
	const bytes = await fs.readFile(new URL("./fixtures/sample-3page.pdf",import.meta.url));
	const ref = await prepareAttachment(new File([bytes],"course.pdf",{type:"application/pdf"}),"2");
	assert.equal(ref.pageCount,3); assert.deepEqual(ref.pages,[2]);
	const content = readAttachment(ref.id).content;
	assert.equal(content.filter(p => p.type === "image").length,1);
	const text = content.filter(p => p.type === "text").map(p => p.text).join("\n");
	assert.match(text,/force/i); assert.doesNotMatch(text,/Chemistry/);
	assert.equal((await downloadAttachment(ref.id)).headers.get("content-disposition")?.startsWith("attachment"),true);
});

test("invalid files, paths and cross-origin uploads are refused, missing backups degrade honestly", async () => {
	await assert.rejects(() => prepareAttachment(new File(["<script>alert(1)</script>"],"fake.png",{type:"image/png"})), /PNG/);
	await assert.rejects(() => prepareAttachment(new File(["%PDF-broken"],"broken.pdf")));
	assert.equal((await downloadAttachment("../auth.json")).status,404);
	assert.equal((await uploadAttachment(new Request("http://localhost:3017/api/attachments",{method:"POST",headers:{origin:"https://evil.example"}}))).status,403);
	assert.match(attachmentContent(["att_"+"b".repeat(32)])[0]!.type === "text" ? (attachmentContent(["att_"+"b".repeat(32)])[0] as {text:string}).text : "",/unavailable/);
	assert.throws(() => parseAttachments([{id:"att_"+"c".repeat(32),name:"x",mimeType:"text/html",size:10}]));
	assert.throws(() => attachmentDirectory("../secret"));
});

test("answer attachments preserve the authored reasoning and never become extraction input", () => {
	const ref = { id:"att_"+"a".repeat(32),name:"reasoning.png",mimeType:"image/png" as const,size:100 };
	const input = parseChatInput({type:"answer",toolCallId:"q1",answer:{kind:"explain",answeredAt:new Date().toISOString(),answers:[{text:"2 + 2 = 5"}],attachments:[ref]}});
	const messages = inputAppends({messages:[{role:"assistant",id:"pose",content:[{type:"toolCall",id:"q1",name:"explain",arguments:{}}]} as never]},input);
	assert.equal(messages[0]!.role,"toolResult");
	assert.match(JSON.stringify(messages[0]),/2 \+ 2 = 5/);
	assert.equal(messages[1]!.role,"custom");
	assert.deepEqual(messages.flatMap(m => messageViewLines(m,m.id)),[]);
	assert.deepEqual(newAttachmentMessage([ref]).details,{attachments:[ref]});
});
