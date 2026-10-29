import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parsePdfPages, attachmentIds, parseAttachments, MAX_PDF_BYTES, formatPdfPages } from "../src/core/attachments.ts";
import { inputAppends, parseChatInput } from "../src/core/input-events.ts";
import { newAttachmentMessage, nativeInputCause, toLlmMessages } from "../src/core/native-messages.ts";
import { messageViewLines } from "../src/core/coverage.ts";
import { projectView } from "../src/core/view.ts";
import { normalizeContext } from "@earendil-works/pi-ai";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "t3learn-attachments-test-"));
process.env.LH_DATA_DIR = root;
const { cliContext } = await import("../src/agent/cli-stream.ts");
const { PATHS } = await import("../config.ts");
assert.equal(PATHS.data, root, "attachment tests must never write to the learner's data directory");
const { prepareAttachment, uploadAttachment, downloadAttachment } = await import("../src/server/attachments.ts");
const { readAttachment, attachmentContent, attachmentDirectory, canonicalAttachment } = await import("../src/store/attachments.ts");
const { lessonPdfTools, sessionPdfRefs } = await import("../src/server/lesson-pdf.ts");
after(() => fs.rm(root, { recursive: true, force: true }));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");

test("PDF selection accepts entire courses and validates exact page ranges", () => {
	assert.deepEqual(parsePdfPages("", 3), [1,2,3]);
	assert.equal(parsePdfPages("all", 400).length,400);
	assert.equal(parsePdfPages("12-35,42",400).length,25);
	assert.equal(formatPdfPages(parsePdfPages("12-35,42",400)),"12-35,42");
	assert.deepEqual(parsePdfPages("3,1-2,2", 20), [1,2,3]);
	for (const [value, count] of [["0",3],["4",3],["3-2",3],["1-1000001",1000000],["garbage",3]] as const) assert.throws(() => parsePdfPages(value,count));
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
	assert.equal(readAttachment(ref.id).content.filter(p => p.type === "image").length,0,"upload does not render the whole course");
	const tools = lessonPdfTools([ref]);
	const { content } = await tools.lesson_pdf_read!.execute("read-1",{id:ref.id,pages:"2"});
	assert.equal(content.filter(p => p.type === "image").length,1);
	const text = content.filter(p => p.type === "text").map(p => p.text).join("\n");
	assert.match(text,/force/i); assert.doesNotMatch(text,/Chemistry/);
	await assert.rejects(() => tools.lesson_pdf_read!.execute("read-outside",{id:ref.id,pages:"1"}),/outside/);
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

/** A real, deterministic PDF with independent text and vector-only pages. */
function coursePdf(count: number, padding = 0): Buffer {
	const objects: string[] = [];
	objects.push('<< /Type /Catalog /Pages 2 0 R >>');
	objects.push(`<< /Type /Pages /Kids [${Array.from({length:count},(_,i) => `${3+i*2} 0 R`).join(' ')}] /Count ${count} >>`);
	const font = 3 + count*2;
	for (let page = 1; page <= count; page++) {
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4+(page-1)*2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
		const body = page === 2 ? '0 0 1 rg 60 60 120 120 re f' : `BT /F1 14 Tf 72 720 Td (Course page ${page}: ${page === count ? 'FINALCHAPTER' : 'lesson material'}) Tj ET`;
		objects.push(`<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`);
	}
	objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
	let doc = '%PDF-1.4\n' + (padding ? `%${' '.repeat(padding)}\n` : '');
	const offsets = [0];
	for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(doc)); doc += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
	const xref = Buffer.byteLength(doc);
	doc += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(doc);
}

test("a course larger than 10 MB uploads completely, searches its last page, and reuses exact scopes", async () => {
	const bytes = coursePdf(120,11*1024*1024);
	const form = new FormData(); form.set("file",new File([new Uint8Array(bytes)],"full-course.pdf",{type:"application/pdf"}));
	const response = await uploadAttachment(new Request("http://localhost:3017/api/attachments",{method:"POST",headers:{origin:"http://localhost:3017"},body:form}));
	assert.equal(response.status,200);
	const ref = await response.json();
	assert.equal(ref.pageCount,120); assert.equal(ref.pages,undefined);
	assert.deepEqual(Buffer.from(await (await downloadAttachment(ref.id)).arrayBuffer()),bytes);
	assert.ok((await fs.stat(path.join(attachmentDirectory(ref.id),"context.json"))).size < 2000);
	const tools = lessonPdfTools([ref]);
	const search = await tools.lesson_pdf_search!.execute("search",{id:ref.id,query:"FINALCHAPTER"});
	assert.match(JSON.stringify(search),/"page":120/);
	const read = await tools.lesson_pdf_read!.execute("last",{id:ref.id,pages:"120"});
	assert.match(JSON.stringify(read.content.filter(c => c.type === "text")),/FINALCHAPTER/);
	assert.equal(read.content.filter(c => c.type === "image").length,1);
	const scan = await tools.lesson_pdf_read!.execute("scan",{id:ref.id,pages:"2"});
	assert.equal(scan.content.filter(c => c.type === "image").length,1);
	const list = await tools.lesson_pdf_list!.execute("list",{id:ref.id});
	assert.match(JSON.stringify(list),/"nextOffset":40/);
	const selected = canonicalAttachment({...ref,pages:parsePdfPages("12-35,42",120)});
	assert.equal(parseAttachments([selected])[0]!.pages!.length,25);
	assert.equal(readAttachment(ref.id).ref.pages,undefined,"changing scope never rewrites the original");
	const refs = sessionPdfRefs([newAttachmentMessage([ref]),newAttachmentMessage([selected])]);
	assert.deepEqual(refs,[selected]);
	await assert.rejects(() => lessonPdfTools(refs).lesson_pdf_read!.execute("outside",{id:ref.id,pages:"120"}),/outside/);
	await assert.rejects(() => tools.lesson_pdf_read!.execute("batch",{id:ref.id,pages:"1-4"}),/3 pages/);
	await assert.rejects(() => lessonPdfTools([]).lesson_pdf_read!.execute("foreign",{id:ref.id,pages:"1"}),/not attached/);
	assert.deepEqual(sessionPdfRefs(JSON.parse(JSON.stringify([newAttachmentMessage([selected])]))),[selected],"scope survives saved transcript reload");
	const wire = toLlmMessages([newAttachmentMessage([selected])],attachmentContent);
	assert.match(JSON.stringify(wire),/pages 12-35,42/);
	assert.doesNotMatch(JSON.stringify(wire),/FINALCHAPTER/);
});

test("PDF size limits and malformed selections fail explicitly", async () => {
	assert.doesNotThrow(() => parseAttachments([{id:"att_"+"f".repeat(32),name:"course.pdf",mimeType:"application/pdf",size:MAX_PDF_BYTES,pageCount:1000}]));
	assert.throws(() => parseAttachments([{id:"att_"+"f".repeat(32),name:"course.pdf",mimeType:"application/pdf",size:MAX_PDF_BYTES+1}]));
	for (const pages of [[],[0],[1.5],["2"]]) assert.throws(() => parseAttachments([{id:"att_"+"f".repeat(32),name:"course.pdf",mimeType:"application/pdf",size:10,pages}]));
	const res = await uploadAttachment(new Request("http://localhost:3017/api/attachments",{method:"POST",headers:{origin:"http://localhost:3017","content-length":String(MAX_PDF_BYTES+65537)}}));
	assert.equal(res.status,413);
});
