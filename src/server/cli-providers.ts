import { CLI_PROVIDERS, isCliProvider, type CliProviderId } from "../core/contracts/cli-providers.ts";
import { configureCli, refreshCli, cliStatus, startCliLogin, cancelCliLogin } from "../agent/cli-providers.ts";
import { piModels } from "../agent/models.ts";
import { readCliConfigs, writeCliConfig } from "../store/cli-providers.ts";

export async function refreshCliCatalog(provider?: string, force = false) {
	const configs = readCliConfigs();
	await Promise.all(CLI_PROVIDERS.map(async ({ id }) => {
		configureCli(id, configs[id]);
		if (!provider || provider === id) await refreshCli(id, piModels().getModels(id === "codex-cli" ? "openai" : "anthropic"), force);
	}));
}
export async function getCliStatuses() { await refreshCliCatalog(); return cliStatus(); }
export async function controlCliProvider(raw: unknown) {
	if (!raw || typeof raw !== "object") throw new Error("Invalid CLI action.");
	const body = raw as Record<string, unknown>;
	if (typeof body.id !== "string" || !isCliProvider(body.id)) throw new Error("Unknown CLI provider.");
	const id: CliProviderId = body.id;
	if (!["connect", "login", "refresh", "cancel", "disconnect", "configure"].includes(String(body.action))) throw new Error("Unknown CLI action.");
	const config = readCliConfigs()[id];
	if (body.binaryPath !== undefined) {
		if (typeof body.binaryPath !== "string" || body.binaryPath.length > 4096 || /[\r\n\0]/.test(body.binaryPath)) throw new Error("Invalid executable path.");
		config.binaryPath = body.binaryPath.trim();
	}
	if (body.allowBackgroundUse !== undefined) {
		if (typeof body.allowBackgroundUse !== "boolean") throw new Error("Invalid background preference.");
		config.allowBackgroundUse = body.allowBackgroundUse;
	}
	if (body.action === "connect" || body.action === "login") config.enabled = true;
	if (body.action === "disconnect") config.enabled = false;
	writeCliConfig(id, config); configureCli(id, config);
	if (body.action === "cancel") cancelCliLogin(id);
	if (body.action === "login") await startCliLogin(id, () => refreshCliCatalog(id, true));
	else await refreshCliCatalog(id, true);
	return cliStatus();
}

/** Login/exec configuration is a loopback-only surface in web development.
 * Packaged apps additionally require the existing desktop API capability. */
export function cliRequestAllowed(request: Request): boolean {
	// Next may canonicalize request.url to localhost even when the window
	// used 127.0.0.1. Validate the actual Host and compare Origin against it.
	let url: URL;
	try {
		const target = new URL(request.url);
		url = new URL(`${target.protocol}//${request.headers.get("host") ?? target.host}`);
	} catch { return false; }
	if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
	const origin = request.headers.get("origin");
	if (origin && origin !== url.origin) return false;
	const site = request.headers.get("sec-fetch-site");
	return !site || site === "same-origin" || site === "none";
}
