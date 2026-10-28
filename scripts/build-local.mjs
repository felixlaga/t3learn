import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

if (process.platform !== "darwin") throw new Error("Build the macOS desktop app on a Mac.");
const root = path.resolve(import.meta.dirname, "..");
// The build identity (electron-builder.local.cjs reads these): CI sets the
// run number and commit; a hand build defaults to build 0 at HEAD.
const commit = process.env.LH_BUILD_COMMIT || spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim() || "";
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false", LH_BUILD_COMMIT: commit };
function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
// Only generated payloads are removed. User data and source files stay outside these paths.
rmSync(path.join(root, ".next/standalone"), { recursive: true, force: true });
run("npm", ["run", "build"]);
run(process.execPath, ["scripts/smoke-provider-runtime.mjs"]);
run(process.execPath, ["scripts/build-server.mjs"]);
run(process.execPath, ["scripts/smoke-server.mjs"]);
// --dmg: a drag-and-drop installer (CI publishes it under the stable name
// T3Learn.dmg for the website link). --zip: the updater's payload. Both
// flags may combine (CI does). Neither: just the unpacked app under
// dist/local.
const target = [...(process.argv.includes("--zip") ? ["zip"] : []), ...(process.argv.includes("--dmg") ? ["dmg"] : [])];
run("npx", ["--no-install", "electron-builder", "--config", "electron-builder.local.cjs", "--mac", ...target, `--${process.arch}`, ...(target.length ? [] : ["--dir"]), "--publish", "never"]);
console.log("Local desktop build ready in dist/local. Open T3Learn.app.");
