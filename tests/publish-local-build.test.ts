/**
 * scripts/publish-local-build.mjs against a recorded `gh`/`git`: the manifest
 * it writes and the exact command sequence for a first publish and for a
 * refresh that must drop a stale zip. Nothing touches GitHub.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { manifestFor, publish, MANIFEST_NAME } from "../scripts/publish-local-build.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

type Call = { command: string; args: string[] };
type Asset = { url: string; sha512: string; size: number; name: string };
const assetsOf = (m: { assets: unknown }) => m.assets as Record<string, Asset>;

function scratch() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-publish-"));
	const dist = path.join(root, "dist", "local");
	fs.mkdirSync(dist, { recursive: true });
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.4.0" }));
	fs.writeFileSync(path.join(dist, "T3Learn-0.4.0-arm64-mac.zip"), Buffer.alloc(1234, 1));
	return { root, dist, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function recorder(answers: (call: Call) => { status: number; stdout?: string } | undefined) {
	const calls: Call[] = [];
	const run = (command: string, args: string[]) => {
		const call = { command, args };
		calls.push(call);
		const answer = answers(call) ?? { status: 0 };
		return { status: answer.status, stdout: answer.stdout ?? "", stderr: answer.status === 0 ? "" : "nope" };
	};
	return { calls, run };
}

describe("publish-local-build", () => {
	it("writes a manifest the updater can parse", () => {
		const m = manifestFor({ version: "0.4.0", build: 7, commit: SHA, builtAt: "2026-10-28T00:00:00.000Z", notes: "n", repo: "felixlaga/t3learn", tag: "local-latest", platformKey: "darwin-arm64", zipName: "T3Learn-0.4.0-arm64-mac.zip", size: 9, sha512: "f".repeat(128) });
		assert.equal(assetsOf(m)["darwin-arm64"]!.url, "https://github.com/felixlaga/t3learn/releases/download/local-latest/T3Learn-0.4.0-arm64-mac.zip");
		assert.equal(m.edition, "t3learn-local");
	});

	it("first publish: creates the tag and the prerelease, then uploads both files", async () => {
		const s = scratch();
		const gh = recorder((call) => {
			if (call.command === "git") return { status: 0, stdout: "Teach plainly\n" };
			if (call.args[0] === "api" && call.args[1] === "-X" && call.args[2] === "PATCH") return { status: 1 };
			if (call.args[0] === "release" && call.args[1] === "view") return { status: 1 };
			return { status: 0 };
		});
		try {
			const manifest = await publish({ dist: s.dist, repo: "felixlaga/t3learn", tag: "local-latest", build: 3, commit: SHA, run: gh.run, log: () => {}, now: () => new Date("2026-10-28T12:00:00Z") });
			const expectedSha = createHash("sha512").update(Buffer.alloc(1234, 1)).digest("hex");
			assert.equal(assetsOf(manifest)["darwin-arm64"]!.sha512, expectedSha);
			assert.equal(assetsOf(manifest)["darwin-arm64"]!.size, 1234);
			assert.equal(manifest.version, "0.4.0");
			assert.equal(manifest.notes, "Teach plainly");
			const onDisk = JSON.parse(fs.readFileSync(path.join(s.dist, MANIFEST_NAME), "utf8"));
			assert.deepEqual(onDisk, manifest);

			const sequence = gh.calls.map((c) => `${c.command} ${c.args.slice(0, 3).join(" ")}`);
			assert.deepEqual(sequence, [
				`git log -1 --format=%s`,
				`gh api -X PATCH`,
				`gh api -X POST`,
				`gh release view local-latest`,
				`gh release create local-latest`,
				`gh release upload local-latest`,
			]);
			const create = gh.calls[4]!.args;
			assert.ok(create.includes("--prerelease"));
			assert.ok(create.includes("T3Learn 0.4.0 build 3"));
			const upload = gh.calls[5]!.args;
			assert.ok(upload.includes(path.join(s.dist, "T3Learn-0.4.0-arm64-mac.zip")));
			assert.ok(upload.includes(path.join(s.dist, MANIFEST_NAME)));
			assert.ok(upload.includes("--clobber"));
		} finally {
			s.cleanup();
		}
	});

	it("refresh: moves the tag, drops a stale zip, edits the notes, uploads", async () => {
		const s = scratch();
		const gh = recorder((call) => {
			if (call.command === "git") return { status: 0, stdout: "subject\n" };
			if (call.args[0] === "release" && call.args[1] === "view") {
				return { status: 0, stdout: JSON.stringify({ assets: [{ name: "T3Learn-0.3.9-arm64-mac.zip" }, { name: MANIFEST_NAME }, { name: "T3Learn-0.4.0-arm64-mac.zip" }] }) };
			}
			return { status: 0 };
		});
		try {
			const manifest = await publish({ dist: s.dist, repo: "felixlaga/t3learn", tag: "local-latest", build: 4, commit: SHA, run: gh.run, log: () => {} });
			const sequence = gh.calls.map((c) => `${c.command} ${c.args.slice(0, 3).join(" ")}`);
			assert.deepEqual(sequence, [
				`git log -1 --format=%s`,
				`gh api -X PATCH`,
				`gh release view local-latest`,
				`gh release delete-asset local-latest`,
				`gh release edit local-latest`,
				`gh release upload local-latest`,
			]);
			assert.equal(gh.calls[3]!.args[3], "T3Learn-0.3.9-arm64-mac.zip", "only the stale zip is removed; the current name is clobbered on upload");
			assert.equal("installer" in assetsOf(manifest)["darwin-arm64"]!, false, "no dmg built, no installer entry");
		} finally {
			s.cleanup();
		}
	});

	it("a DMG rides along under its stable name: manifest installer entry, stale dmgs removed, uploaded with the zip", async () => {
		const s = scratch();
		fs.writeFileSync(path.join(s.dist, "T3Learn.dmg"), Buffer.alloc(99, 2));
		const gh = recorder((call) => {
			if (call.command === "git") return { status: 0, stdout: "subject\n" };
			if (call.args[0] === "release" && call.args[1] === "view") {
				return { status: 0, stdout: JSON.stringify({ assets: [{ name: "T3Learn-0.3.9-arm64.dmg" }, { name: "T3Learn.dmg" }, { name: "T3Learn-0.4.0-arm64-mac.zip" }] }) };
			}
			return { status: 0 };
		});
		try {
			const manifest = await publish({ dist: s.dist, repo: "felixlaga/t3learn", tag: "local-latest", build: 5, commit: SHA, run: gh.run, log: () => {} });
			const installer = (assetsOf(manifest)["darwin-arm64"] as unknown as { installer: Asset }).installer;
			assert.equal(installer.name, "T3Learn.dmg");
			assert.equal(installer.url, "https://github.com/felixlaga/t3learn/releases/download/local-latest/T3Learn.dmg", "the link a website can keep");
			assert.equal(installer.size, 99);
			assert.equal(installer.sha512, createHash("sha512").update(Buffer.alloc(99, 2)).digest("hex"));
			const removed = gh.calls.filter((c) => c.args[0] === "release" && c.args[1] === "delete-asset").map((c) => c.args[3]);
			assert.deepEqual(removed, ["T3Learn-0.3.9-arm64.dmg"], "the old versioned dmg goes; the stable name is clobbered");
			const upload = gh.calls.at(-1)!.args;
			assert.ok(upload.includes(path.join(s.dist, "T3Learn.dmg")));
			assert.ok(upload.includes(path.join(s.dist, "T3Learn-0.4.0-arm64-mac.zip")));
			const edit = gh.calls.find((c) => c.args[0] === "release" && c.args[1] === "edit")!.args;
			assert.ok(edit.join(" ").includes("T3Learn.dmg"), "the notes link the download");
		} finally {
			s.cleanup();
		}
	});

	it("refuses a bad build number, sha or repo, and a dist without exactly one zip", async () => {
		const s = scratch();
		try {
			await assert.rejects(publish({ dist: s.dist, repo: "felixlaga/t3learn", tag: "t", build: 0, commit: SHA, run: () => ({ status: 0, stdout: "", stderr: "" }), log: () => {} }), /positive integer/);
			await assert.rejects(publish({ dist: s.dist, repo: "felixlaga/t3learn", tag: "t", build: 1, commit: "short", run: () => ({ status: 0, stdout: "", stderr: "" }), log: () => {} }), /full sha/);
			await assert.rejects(publish({ dist: s.dist, repo: "bad repo", tag: "t", build: 1, commit: SHA, run: () => ({ status: 0, stdout: "", stderr: "" }), log: () => {} }), /owner\/name/);
			fs.writeFileSync(path.join(s.dist, "second.zip"), "x");
			await assert.rejects(publish({ dist: s.dist, repo: "felixlaga/t3learn", tag: "t", build: 1, commit: SHA, run: () => ({ status: 0, stdout: "", stderr: "" }), log: () => {} }), /exactly one zip/);
		} finally {
			s.cleanup();
		}
	});
});
