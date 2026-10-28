import { backupSync } from "@/src/server";

/**
 * /api/backup (backup wave, 2026-10-28) — the automatic GitHub backup's
 * status and its off switch.
 *   GET    → the BackupStatus the Backup section renders.
 *   DELETE → disconnect: forget the token, turn the loop off, keep the
 *            repository name for a later reconnect.
 * The on/off toggle and the name ride PUT /api/settings/backup.
 */
export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(backupSync().status());
}

export async function DELETE() {
	return Response.json(backupSync().disconnect());
}
