import { getCliStatuses, controlCliProvider, cliRequestAllowed } from "@/src/server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
	if (!cliRequestAllowed(request)) return Response.json({ error: "CLI connections require this app on localhost." }, { status: 403 });
	try { return Response.json({ providers: await getCliStatuses() }, { headers: { "Cache-Control": "no-store" } }); }
	catch { return Response.json({ error: "Could not read CLI provider settings." }, { status: 500 }); }
}
export async function POST(request: Request) {
	if (!cliRequestAllowed(request)) return Response.json({ error: "CLI connections require this app on localhost." }, { status: 403 });
	try { return Response.json({ providers: await controlCliProvider(await request.json()) }, { headers: { "Cache-Control": "no-store" } }); }
	catch { return Response.json({ error: "Could not change the CLI connection. Check the executable path and try again." }, { status: 400 }); }
}
