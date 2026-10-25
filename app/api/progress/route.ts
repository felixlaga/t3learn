import { validProgressTimeZone } from "@/src/core";
import { getLearningProgress } from "@/src/server";

export const dynamic = "force-dynamic";
export function GET(request: Request) {
	const timeZone = new URL(request.url).searchParams.get("timeZone") ?? "UTC";
	if (!validProgressTimeZone(timeZone)) return Response.json({ error: "Invalid time zone." }, { status: 400 });
	try { return Response.json(getLearningProgress(timeZone), { headers: { "Cache-Control": "no-store" } }); }
	catch { return Response.json({ error: "Could not read your progress. Your learning records have not been changed." }, { status: 500 }); }
}
