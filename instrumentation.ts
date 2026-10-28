/**
 * Next's boot hook (docs: 01-app/02-guides/instrumentation.md): `register`
 * runs once per server instance, before the first request. The one thing
 * we start here is the automatic GitHub backup loop (src/server/backup.ts),
 * which must live from boot, not from whichever route happens to load
 * first. Node runtime only; never under the test runner (tests drive the
 * loop directly against a loopback GitHub).
 */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV === "test") return;
	const { startBackupSync } = await import("./src/server/backup.ts");
	startBackupSync();
}
