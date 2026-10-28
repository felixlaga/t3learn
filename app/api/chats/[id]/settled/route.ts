import { getChat, stores } from "@/src/server";

/**
 * PUT /api/chats/[id]/settled — settle or un-settle a session (owner,
 * 2026-10-28: the sidebar's Settled shelf, T3 Code's pattern). Body:
 * { settled: boolean }. The store owns the stamps (settle keeps
 * updatedAt, un-settle bumps it so the row returns to the top) and
 * announces chats-changed; the sidebar patches its snapshot at once and
 * the event refetch lands the durable truth.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { settled?: unknown } | null;
	if (typeof body?.settled !== "boolean") {
		return Response.json({ error: "settled must be a boolean" }, { status: 400 });
	}
	const record = stores.chatStore.setSettled(id, body.settled);
	return Response.json({ settledAt: record.settledAt ?? null, updatedAt: record.updatedAt });
}
