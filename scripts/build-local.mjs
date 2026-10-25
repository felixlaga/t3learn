import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

if (process.platform !== "darwin") throw new Error("Build the macOS desktop app on a Mac.");
const root = path.resolve(import.meta.dirname, "..");
function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
// Only generated payloads are removed. User data and source files stay outside these paths.
rmSync(path.join(root, ".next/standalone"), { recursive: true, force: true });
run("npm", ["run", "build"]);
run(process.execPath, ["scripts/smoke-provider-runtime.mjs"]);
run(process.execPath, ["scripts/build-server.mjs"]);
run(process.execPath, ["scripts/smoke-server.mjs"]);
run("npx", ["--no-install", "electron-builder", "--config", "electron-builder.local.cjs", "--mac", ...(process.argv.includes("--dmg") ? ["dmg"] : []), `--${process.arch}`, ...(process.argv.includes("--dmg") ? [] : ["--dir"]), "--publish", "never"]);
console.log("Local desktop build ready in dist/local. Open LearnHarness Local.app.");
