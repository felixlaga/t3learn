/**
 * The Progress trigger (components/progress-dialog.tsx ProgressButton):
 * the trophy in the sidebar's icon row must open the dialog. Regression
 * pin for 2026-10-29: Dialog.Trigger asChild merges its click/aria props
 * into its child, and the tooltip wrapper (Hint) is a plain component
 * that drops them — so the trigger must sit INSIDE the tooltip, on the
 * button itself. The server render pins the merged attributes on the
 * button: with the trigger outside the tooltip they vanish, and so does
 * the click. (A mounted click is checked in a real browser; linkedom
 * cannot attach Radix's portal, so no DOM test here.)
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgressButton } from "../components/progress-dialog.tsx";

describe("ProgressButton", () => {
	it("the dialog trigger's props land on the trophy button itself (not on the tooltip wrapper)", () => {
		const html = renderToStaticMarkup(<ProgressButton />);
		const button = html.match(/<button[^>]*data-testid="progress-entry"[^>]*>/)?.[0] ?? "";
		assert.ok(button, "the trophy button renders");
		assert.match(button, /aria-haspopup="dialog"/, "Dialog.Trigger merged into the button");
		assert.match(button, /aria-expanded="false"/, "closed until clicked");
		assert.match(button, /aria-label="Progress"/);
		assert.match(button, /data-slot="tooltip-trigger"/, "the tooltip still wraps it");
	});
});
