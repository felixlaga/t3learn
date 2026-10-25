/** CLI accounts are separate routes from direct API-key providers. */
export const CLI_PROVIDERS = [
	{ id: "codex-cli", label: "Codex CLI", command: "codex", login: "codex login" },
	{ id: "claude-code", label: "Claude Code", command: "claude", login: "claude auth login" },
] as const;
export type CliProviderId = typeof CLI_PROVIDERS[number]["id"];
export interface CliProviderConfig { enabled: boolean; binaryPath: string; allowBackgroundUse: boolean }
export interface CliProviderStatus extends CliProviderConfig {
	id: CliProviderId;
	connected: boolean;
	pending: boolean;
	modelCount: number;
	message?: string;
	authorizationUrl?: string;
}
export function isCliProvider(id: string | undefined): id is CliProviderId {
	return CLI_PROVIDERS.some((p) => p.id === id);
}
