/**
 * Update-button render tests (owner, 2026-10-28; round icon the same
 * day): the button is a pure function of the last lh:update-status push,
 * seeded by one updateState() read. Hidden without a bridge (browser /
 * SSR); always present in the desktop app, where idle reads "Up to date"
 * and a click checks again. Each state carries its wording (the hidden
 * label) and its click. Same linkedom + createRoot shape as the retired
 * banner test.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as ReactDOMClient from "react-dom/client";
import { flushSync } from "react-dom";
import { parseHTML } from "linkedom";
import { UpdatePill, type UpdateStatus } from "../components/update-pill.tsx";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent });

type Push = (s: UpdateStatus) => void;
type Bridge = {
	onUpdateStatus: (cb: Push) => () => void;
	updateState?: () => Promise<UpdateStatus | null>;
	checkForUpdate?: () => Promise<UpdateStatus>;
	downloadUpdate?: () => Promise<UpdateStatus>;
	installUpdate?: () => void;
};

function status(partial: Partial<UpdateStatus> & { status: UpdateStatus["status"] }): UpdateStatus {
	return { version: "0.4.0", build: 12, ...partial };
}

async function mount(bridge: Bridge) {
	(window as { lh?: unknown }).lh = bridge;
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = ReactDOMClient.createRoot(host);
	flushSync(() => root.render(<UpdatePill />));
	await new Promise((r) => setTimeout(r, 0));
	return { host, root, pill: () => host.querySelector<HTMLElement>("[data-testid='update-pill']") };
}

describe("update pill", () => {
	afterEach(() => {
		delete (window as { lh?: unknown }).lh;
	});

	it("renders nothing without a bridge (browser / SSR)", () => {
		assert.equal(renderToStaticMarkup(<UpdatePill />), "");
	});

	it("idle reads 'Up to date' and checks on click; 'Update available' downloads on click", async () => {
		let push: Push | null = null;
		let downloads = 0;
		let checks = 0;
		const { host, root, pill } = await mount({
			onUpdateStatus: (cb) => { push = cb; return () => {}; },
			updateState: async () => status({ status: "idle", version: null, build: null }),
			checkForUpdate: async () => { checks += 1; return status({ status: "idle" }); },
			downloadUpdate: async () => { downloads += 1; return status({ status: "downloading", percent: 0 }); },
		});
		await new Promise((r) => setTimeout(r, 0));
		flushSync(() => {});
		const idle = pill();
		assert.ok(idle, "the desktop app always shows the button (T3 Code's row)");
		assert.equal(idle!.dataset.status, "idle");
		assert.ok(idle!.textContent?.includes("Up to date"));
		idle!.click();
		assert.equal(checks, 1, "an idle click checks for updates");

		flushSync(() => push?.(status({ status: "available", notes: "Teach plainly" })));
		const button = pill();
		assert.ok(button, "the button renders once an update is available");
		assert.equal(button!.dataset.status, "available");
		assert.ok(button!.textContent?.includes("Update available"));
		button!.click();
		assert.equal(downloads, 1, "a click starts the download");

		flushSync(() => push?.(status({ status: "downloading", percent: 42 })));
		assert.ok(pill()!.textContent?.includes("Downloading 42%"));
		assert.equal((pill() as HTMLButtonElement).disabled, true, "nothing to click while downloading");
		root.unmount();
		host.remove();
	});

	it("'Restart to update' installs, and the seed covers a push sent before mount", async () => {
		let installs = 0;
		const { host, root, pill } = await mount({
			onUpdateStatus: () => () => {},
			updateState: async () => status({ status: "downloaded", percent: 100 }),
			installUpdate: () => { installs += 1; },
		});
		await new Promise((r) => setTimeout(r, 0));
		flushSync(() => {});
		const button = pill();
		assert.ok(button, "the seed alone renders the pill");
		assert.equal(button!.dataset.status, "downloaded");
		assert.ok(button!.textContent?.includes("Restart to update"));
		button!.click();
		assert.equal(installs, 1);
		root.unmount();
		host.remove();
	});

	it("a failed step shows 'Update failed' and retries the right step", async () => {
		let push: Push | null = null;
		let checks = 0;
		let downloads = 0;
		const { host, root, pill } = await mount({
			onUpdateStatus: (cb) => { push = cb; return () => {}; },
			checkForUpdate: async () => { checks += 1; return status({ status: "idle" }); },
			downloadUpdate: async () => { downloads += 1; return status({ status: "downloading" }); },
		});
		flushSync(() => push?.(status({ status: "error", message: "feed answered 503", retry: "check" })));
		assert.ok(pill()!.textContent?.includes("Update failed"));
		pill()!.click();
		assert.equal(checks, 1);
		assert.equal(downloads, 0);

		flushSync(() => push?.(status({ status: "error", message: "checksum", retry: "download" })));
		pill()!.click();
		assert.equal(downloads, 1);
		root.unmount();
		host.remove();
	});
});
