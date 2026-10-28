import { backupSync, BackupInputError } from "@/src/server";

/** PUT /api/backup/repo { name } — use (or create, private) the repository
 *  on the signed-in account, turn the loop on, and push the first snapshot.
 *  400 for a bad name / no token / a public repository of that name; 502
 *  when GitHub refused. */
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
	const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
	if (typeof body?.name !== "string") return Response.json({ error: "name must be a string" }, { status: 400 });
	try {
		return Response.json(await backupSync().connectRepo(body.name.trim()));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return Response.json({ error: message }, { status: err instanceof BackupInputError ? 400 : 502 });
	}
}
