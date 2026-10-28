import { backupSync, BackupInputError } from "@/src/server";

/** POST /api/backup/login — start the GitHub device-code sign-in. The
 *  answer carries the code to type and the page to type it on; the server
 *  polls GitHub itself and announces backup-changed when the token lands.
 *  409 when this build has no client id (paste a token instead). */
export const dynamic = "force-dynamic";

export async function POST() {
	try {
		return Response.json(await backupSync().startDeviceLogin());
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return Response.json({ error: message }, { status: err instanceof BackupInputError ? 409 : 502 });
	}
}
