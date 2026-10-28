import { backupSync } from "@/src/server";

/** POST /api/backup/push — push now (the Back up now button). Answers the
 *  status after the push; a failure is in lastError, never a 5xx (the loop
 *  retries on its own). */
export const dynamic = "force-dynamic";

export async function POST() {
	return Response.json(await backupSync().pushNow());
}
