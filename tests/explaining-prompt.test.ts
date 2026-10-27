/**
 * The explaining doctrine (owner, 2026-10-28): shared/12-explaining.md
 * composes into EVERY agent whose prose the learner reads (prober,
 * teacher, practice), and the fragments that steer the register stay in
 * the plain register themselves (no em dashes, no "use markdown
 * maximally" default), because the prompt's own style leaks into the
 * lesson.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { PATHS } from "../config.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";

const FRAGMENT = path.join(PATHS.root, "src/agent/prompts/shared/12-explaining.md");

describe("the explaining doctrine (shared/12-explaining.md)", () => {
	it("composes into prober, teacher and practice", () => {
		for (const kind of ["prober", "teacher", "practice"] as const) {
			const prompt = composeInstructions(kind);
			assert.match(prompt, /## How to explain/, `${kind} carries the doctrine`);
			assert.match(prompt, /Meaning first, name second/, `${kind} carries the moves`);
			assert.match(prompt, /### What he never sees/, `${kind} carries the ban list`);
		}
	});

	it("sits right after the voice in composition order", () => {
		const teacher = composeInstructions("teacher");
		assert.ok(teacher.indexOf("## Voice") < teacher.indexOf("## How to explain"));
		assert.ok(teacher.indexOf("## How to explain") < teacher.indexOf("## Accuracy"));
	});

	it("is written in the register it asks for: no em dashes, no project jargon used as prose", () => {
		const text = readFileSync(FRAGMENT, "utf-8");
		assert.equal(text.includes("—"), false, "no em dashes in the explaining fragment");
		assert.equal(text.includes(" -- "), false, "no spaced double hyphens either");
	});

	it("the formatting default is short paragraphs, not a structured document", () => {
		const formatting = readFileSync(path.join(PATHS.root, "src/agent/prompts/shared/40-formatting.md"), "utf-8");
		assert.doesNotMatch(formatting, /Use it maximally/);
		assert.doesNotMatch(formatting, /the default is a structured document/);
		assert.match(formatting, /short paragraphs of one to three sentences/);
		// the authoring contract for math is untouched
		assert.match(formatting, /Use `\$\.\.\.\$` for inline math/);
	});

	it("the voice says no padding never means compressing, and teaching asks for plain, not tight", () => {
		const teacher = composeInstructions("teacher");
		assert.match(teacher, /It never means packing three ideas into one clever line/);
		assert.match(teacher, /The output is plain, clear teaching/);
		assert.doesNotMatch(teacher, /the output is tight, clear teaching/);
	});
});
