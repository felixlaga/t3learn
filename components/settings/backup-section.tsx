"use client";
/**
 * THE BACKUP SECTION (backup wave, owner 2026-10-28): Settings → Backup,
 * and the setup dialog's last stage. Three states, read from GET
 * /api/backup and refreshed on every backup-changed event:
 *
 *   1. Not signed in — "Connect GitHub" starts the device-code sign-in
 *      (the code and the github.com link appear here; the server polls),
 *      or a token is pasted (PUT /api/keys/GITHUB_BACKUP_TOKEN). The
 *      pasted path is the only one when the build has no client id.
 *   2. Signed in, no repository — a name (t3learn-data proposed) and
 *      "Create private repository" (PUT /api/backup/repo; an existing
 *      private repository of that name is used as-is).
 *   3. Connected — the repository link, the on/off toggle (PUT
 *      /api/settings/backup), the last push with "Back up now" (POST
 *      /api/backup/push), the last error, skipped records, Disconnect.
 *
 * BackupBody is the pure render (SSR-pinned by tests); BackupSection owns
 * the fetches.
 */

import { useCallback, useEffect, useState } from "react";
import { BACKUP_DEFAULT_REPO, EMPTY_BACKUP_STATUS, validBackupRepoName, type BackupStatus } from "@/src/core";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { notifySettingsSaved } from "@/components/settings-signal";
import { SettingsRow, Toggle } from "./controls.tsx";
import { timeAgo } from "@/components/time-ago";

const BUTTON = "shrink-0 rounded-sm border border-border bg-background px-3 py-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-40";
const INPUT = "h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50";

export interface BackupBodyProps {
	status: BackupStatus | null;
	busy: boolean;
	error: string | null;
	repoName: string;
	tokenValue: string;
	onRepoName: (v: string) => void;
	onTokenValue: (v: string) => void;
	onConnect: () => void;
	onSaveToken: () => void;
	onCreateRepo: () => void;
	onPushNow: () => void;
	onToggle: (on: boolean) => void;
	onDisconnect: () => void;
	/** The setup dialog passes true: shorter copy, no Disconnect. */
	compact?: boolean;
}

export function BackupBody({ status, busy, error, repoName, tokenValue, onRepoName, onTokenValue, onConnect, onSaveToken, onCreateRepo, onPushNow, onToggle, onDisconnect, compact = false }: BackupBodyProps) {
	if (!status) return <p className="text-xs text-muted-foreground/70">Loading…</p>;
	const problem = error ?? status.lastError;

	if (!status.connected) {
		return (
			<div className="flex flex-col gap-3" data-testid="backup-stage-signin">
				<p className="text-xs text-muted-foreground">
					Your sessions, knowledge graph and learning records go to a private GitHub repository the app creates for you. Every change is pushed on its own. Nothing else is sent: no keys, no logins.
				</p>
				{status.clientId && !status.device && (
					<div>
						<button type="button" data-testid="backup-connect" disabled={busy} onClick={onConnect} className={BUTTON}>
							Connect GitHub
						</button>
					</div>
				)}
				{status.device && (
					<div data-testid="backup-device" className="flex flex-col gap-1 rounded-sm border border-border/60 px-3 py-2">
						<p className="text-xs text-muted-foreground">Enter this code on GitHub, then come back. The app finishes on its own.</p>
						<p className="font-mono text-lg tracking-widest text-foreground" data-testid="backup-device-code">{status.device.userCode}</p>
						<a href={status.device.verificationUri} target="_blank" rel="noreferrer" className="text-xs text-foreground underline underline-offset-2">
							Open {status.device.verificationUri.replace(/^https?:\/\//, "")} ↗
						</a>
						<p className="text-xs text-muted-foreground/70">Waiting for GitHub…</p>
					</div>
				)}
				<div className="flex flex-col gap-1">
					<p className="text-xs text-muted-foreground">{status.clientId ? "Or paste a token:" : "Paste a GitHub token (classic token with the repo scope):"}</p>
					<div className="flex max-w-96 items-center gap-2">
						<input
							type="text"
							value={tokenValue}
							onChange={(e) => onTokenValue(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && tokenValue.trim()) onSaveToken();
							}}
							placeholder="ghp_… or github_pat_…"
							aria-label="GitHub token"
							data-testid="backup-token-input"
							disabled={busy}
							className={INPUT}
						/>
						<button type="button" data-testid="backup-token-save" disabled={busy || !tokenValue.trim()} onClick={onSaveToken} className={BUTTON}>
							Save token
						</button>
					</div>
					<a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline underline-offset-2">
						Create a token on github.com ↗
					</a>
				</div>
				{problem && <p role="alert" data-testid="backup-error" className="text-xs text-amber-400">{problem}</p>}
			</div>
		);
	}

	if (!status.repo) {
		return (
			<div className="flex flex-col gap-3" data-testid="backup-stage-repo">
				<p className="text-xs text-muted-foreground">
					Signed in{status.login ? ` as ${status.login}` : ""}. Name the private repository for your learning records. The app creates it if it does not exist.
				</p>
				<div className="flex max-w-96 items-center gap-2">
					<input
						type="text"
						value={repoName}
						onChange={(e) => onRepoName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && validBackupRepoName(repoName.trim())) onCreateRepo();
						}}
						aria-label="Repository name"
						data-testid="backup-repo-input"
						disabled={busy}
						className={INPUT}
					/>
					<button type="button" data-testid="backup-repo-create" disabled={busy || !validBackupRepoName(repoName.trim())} onClick={onCreateRepo} className={BUTTON}>
						{busy ? "Creating…" : "Create private repository"}
					</button>
				</div>
				{problem && <p role="alert" data-testid="backup-error" className="text-xs text-amber-400">{problem}</p>}
				{!compact && (
					<div>
						<button type="button" data-testid="backup-disconnect" disabled={busy} onClick={onDisconnect} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
							Sign out of GitHub
						</button>
					</div>
				)}
			</div>
		);
	}

	const when = status.pushing ? "Pushing…" : status.pending ? "Changes waiting…" : status.lastPushAt ? `${timeAgo(status.lastPushAt)} (${status.files} records)` : "Not yet";
	return (
		<div className="flex flex-col gap-2" data-testid="backup-stage-connected">
			<SettingsRow label="Repository" hint="Private, on your GitHub account" testid="row-backup-repo">
				<a href={status.repoUrl ?? "#"} target="_blank" rel="noreferrer" data-testid="backup-repo-link" className="truncate font-mono text-xs text-foreground underline underline-offset-2">
					{status.login}/{status.repo} ↗
				</a>
			</SettingsRow>
			<SettingsRow label="Back up automatically" hint="About half a minute after each change" testid="row-backup-enabled">
				<Toggle checked={status.enabled} disabled={busy} label="automatic backup" onChange={onToggle} />
			</SettingsRow>
			<SettingsRow label="Last backup" testid="row-backup-last">
				<span className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground" data-testid="backup-last">{when}</span>
					<button type="button" data-testid="backup-push-now" disabled={busy || status.pushing} onClick={onPushNow} className={BUTTON}>
						Back up now
					</button>
				</span>
			</SettingsRow>
			{problem && <p role="alert" data-testid="backup-error" className="text-xs text-amber-400">{problem}</p>}
			{status.skipped.length > 0 && (
				<p className="text-xs text-muted-foreground/70" data-testid="backup-skipped">
					Left out (over 10 MiB): {status.skipped.join(", ")}
				</p>
			)}
			{!compact && (
				<div className="pt-1">
					<button type="button" data-testid="backup-disconnect" disabled={busy} onClick={onDisconnect} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
						Disconnect
					</button>
				</div>
			)}
		</div>
	);
}

/** The stateful section: one GET on mount, refetch on backup-changed and
 *  on resync, the actions as fetches. `onConnected` (the setup stage)
 *  fires once a repository is in place. */
export function BackupSection({ compact = false, onConnected }: { compact?: boolean; onConnected?: () => void }) {
	const [status, setStatus] = useState<BackupStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [repoName, setRepoName] = useState(BACKUP_DEFAULT_REPO);
	const [tokenValue, setTokenValue] = useState("");

	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/backup", { cache: "no-store" });
			if (!res.ok) throw new Error(String(res.status));
			const next = (await res.json()) as BackupStatus;
			setStatus(next);
			if (next.repo) setRepoName(next.repo);
		} catch {
			setStatus((prev) => prev ?? { ...EMPTY_BACKUP_STATUS });
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useServerEvent("backup-changed", () => void refresh());
	useServerResync(() => void refresh());
	useEffect(() => {
		if (status?.repo && status.connected) onConnected?.();
	}, [status?.repo, status?.connected, onConnected]);

	/** One action shape: busy on, the call, the answered status (or its
	 *  error line), busy off. */
	const act = useCallback(async (call: () => Promise<Response>) => {
		setBusy(true);
		setError(null);
		try {
			const res = await call();
			const body = (await res.json().catch(() => ({}))) as Partial<BackupStatus> & { error?: string };
			if (!res.ok) {
				setError(body.error ?? `Request failed (${res.status})`);
				return;
			}
			if ("connected" in body) setStatus(body as BackupStatus);
			else void refresh();
		} catch {
			setError("Request failed. Check your connection and try again.");
		} finally {
			setBusy(false);
		}
	}, [refresh]);

	return (
		<BackupBody
			status={status}
			busy={busy}
			error={error}
			repoName={repoName}
			tokenValue={tokenValue}
			onRepoName={setRepoName}
			onTokenValue={setTokenValue}
			onConnect={() => void act(() => fetch("/api/backup/login", { method: "POST" }))}
			onSaveToken={() =>
				void act(async () => {
					const res = await fetch("/api/keys/GITHUB_BACKUP_TOKEN", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: tokenValue }) });
					if (res.ok) {
						setTokenValue("");
						notifySettingsSaved("keys");
					}
					return res;
				})
			}
			onCreateRepo={() => void act(() => fetch("/api/backup/repo", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: repoName.trim() }) }))}
			onPushNow={() => void act(() => fetch("/api/backup/push", { method: "POST" }))}
			onToggle={(on) =>
				void act(() => fetch("/api/settings/backup", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: on, ...(status?.repo ? { repo: status.repo } : {}) }) }))
			}
			onDisconnect={() => void act(() => fetch("/api/backup", { method: "DELETE" }))}
			compact={compact}
		/>
	);
}
