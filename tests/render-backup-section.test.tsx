/**
 * The Backup section's three states, SSR-pinned (backup wave, 2026-10-28):
 * sign-in (Connect GitHub when the build has a client id, the device code
 * while one is pending, the token paste always), the repository name
 * screen, and the connected view with its toggle, last push and
 * Disconnect (hidden in the setup dialog's compact form).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BackupBody, type BackupBodyProps } from "../components/settings/backup-section.tsx";
import { EMPTY_BACKUP_STATUS, type BackupStatus } from "../src/core/backup.ts";

function render(status: Partial<BackupStatus> | null, extra: Partial<BackupBodyProps> = {}) {
	const noop = () => {};
	return renderToStaticMarkup(
		<BackupBody
			status={status ? { ...EMPTY_BACKUP_STATUS, ...status } : null}
			busy={false}
			error={null}
			repoName="t3learn-data"
			tokenValue=""
			onRepoName={noop}
			onTokenValue={noop}
			onConnect={noop}
			onSaveToken={noop}
			onCreateRepo={noop}
			onPushNow={noop}
			onToggle={noop}
			onDisconnect={noop}
			{...extra}
		/>,
	);
}

describe("BackupBody", () => {
	it("loading, then sign-in: Connect GitHub only with a client id; the token paste always", () => {
		assert.match(render(null), /Loading…/);
		const withClient = render({ clientId: true });
		assert.match(withClient, /data-testid="backup-stage-signin"/);
		assert.match(withClient, /data-testid="backup-connect"/);
		assert.match(withClient, /data-testid="backup-token-input"/);
		const without = render({ clientId: false });
		assert.doesNotMatch(without, /backup-connect/);
		assert.match(without, /Paste a GitHub token/);
	});

	it("a pending device code shows the code and the github.com link, and hides Connect", () => {
		const html = render({ clientId: true, device: { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresAt: "2026-10-28T12:00:00Z" } });
		assert.match(html, /ABCD-1234/);
		assert.match(html, /href="https:\/\/github.com\/login\/device"/);
		assert.doesNotMatch(html, /data-testid="backup-connect"/);
	});

	it("signed in without a repository: the name field and Create", () => {
		const html = render({ connected: true, login: "felix" });
		assert.match(html, /data-testid="backup-stage-repo"/);
		assert.match(html, /Signed in as felix/);
		assert.match(html, /value="t3learn-data"/);
		assert.match(html, /data-testid="backup-repo-create"/);
	});

	it("connected: the link, the toggle, the last push, errors and skipped records; compact hides Disconnect", () => {
		const html = render({ connected: true, login: "felix", repo: "t3learn-data", repoUrl: "https://github.com/felix/t3learn-data", enabled: true, lastPushAt: new Date(Date.now() - 120_000).toISOString(), files: 12, lastError: "GitHub answered 502", skipped: ["chats/big.json"] });
		assert.match(html, /data-testid="backup-stage-connected"/);
		assert.match(html, /felix\/t3learn-data/);
		assert.match(html, /aria-checked="true"/);
		assert.match(html, /2m ago \(12 records\)/);
		assert.match(html, /GitHub answered 502/);
		assert.match(html, /chats\/big.json/);
		assert.match(html, /data-testid="backup-disconnect"/);
		assert.doesNotMatch(render({ connected: true, login: "f", repo: "r", repoUrl: "u" }, { compact: true }), /backup-disconnect/);
		assert.match(render({ connected: true, login: "f", repo: "r", repoUrl: "u", pushing: true }), /Pushing…/);
		assert.match(render({ connected: true, login: "f", repo: "r", repoUrl: "u", pending: true }), /Changes waiting…/);
	});
});
