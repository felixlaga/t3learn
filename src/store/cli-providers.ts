import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { CLI_PROVIDERS, type CliProviderConfig, type CliProviderId } from "../core/contracts/cli-providers.ts";

const file = path.join(PATHS.data, "cli-providers.json");
export function readCliConfigs(): Record<CliProviderId, CliProviderConfig> {
	let raw: Record<string, Partial<CliProviderConfig>> = {};
	try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Could not read CLI provider settings."); }
	return Object.fromEntries(CLI_PROVIDERS.map(({ id }) => [id, { enabled: raw[id]?.enabled === true, binaryPath: typeof raw[id]?.binaryPath === "string" ? raw[id].binaryPath : "", allowBackgroundUse: raw[id]?.allowBackgroundUse !== false }])) as Record<CliProviderId, CliProviderConfig>;
}
export function writeCliConfig(id: CliProviderId, config: CliProviderConfig) {
	const configs = readCliConfigs(); configs[id] = config;
	fs.mkdirSync(PATHS.data, { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, JSON.stringify(configs, null, 2) + "\n", { mode: 0o600 }); fs.renameSync(temp, file);
	return configs;
}
