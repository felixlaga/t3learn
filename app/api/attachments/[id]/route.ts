import { downloadAttachment } from "@/src/server";
export const runtime = "nodejs";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	return downloadAttachment((await params).id);
}
