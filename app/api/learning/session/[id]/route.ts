import { learningSessionDetail, cliRequestAllowed } from "@/src/server";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	if (!cliRequestAllowed(req)) return Response.json({ error: "A local, same-origin window is required." }, { status: 403 });
	try { return Response.json(learningSessionDetail((await params).id), { headers: { "Cache-Control": "no-store" } }); }
	catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Learning records are unavailable." }, { status: 400 }); }
}
