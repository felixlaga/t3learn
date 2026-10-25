"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2Icon, TerminalIcon, LoaderCircleIcon, ExternalLinkIcon } from "lucide-react";
import { CLI_PROVIDERS, type CliProviderId, type CliProviderStatus } from "@/src/core";
import { notifySettingsSaved } from "../settings-signal";
import { Button } from "../ui/button";

export function CliConnections() {
	const [statuses, setStatuses] = useState<CliProviderStatus[]>([]);
	const [busy, setBusy] = useState<CliProviderId | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [paths, setPaths] = useState<Partial<Record<CliProviderId, string>>>({});
	const fingerprint = useRef("");
	function accept(providers: CliProviderStatus[]) {
		setStatuses(providers);
		const next = JSON.stringify(providers.map((p) => [p.id, p.connected, p.modelCount, p.allowBackgroundUse]));
		if (fingerprint.current && fingerprint.current !== next) notifySettingsSaved("keys");
		fingerprint.current = next;
	}
	useEffect(() => {
		let cancelled = false;
		async function refresh() {
			try { const response = await fetch("/api/cli-providers"); const body = await response.json(); if (!response.ok) throw new Error(body.error); if (!cancelled) accept(body.providers); }
			catch { if (!cancelled) setError("CLI connections are available in the desktop app or a local development server."); }
		}
		void refresh();
		const timer = setInterval(() => { void refresh(); }, 3000);
		return () => { cancelled = true; clearInterval(timer); };
	}, []);
	async function act(id: CliProviderId, action: string, extra: Record<string, unknown> = {}) {
		setBusy(id); setError(null);
		try {
			const response = await fetch("/api/cli-providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...(paths[id] !== undefined ? { binaryPath: paths[id] } : {}), ...extra }) });
			const body = await response.json(); if (!response.ok) throw new Error(body.error);
			accept(body.providers); notifySettingsSaved("keys");
		} catch (error) { setError(error instanceof Error ? error.message : "Could not update the CLI connection."); }
		finally { setBusy(null); }
	}
	return <div className="space-y-3" data-testid="cli-connections">
		<div className="flex items-center gap-2 font-ui text-xs text-muted-foreground"><TerminalIcon className="size-3.5" />Use your CLI subscriptions</div>
		<p className="text-xs leading-relaxed text-muted-foreground">Connect an installed Codex or Claude Code CLI. Sign in with your subscription; credentials stay with the CLI. Selected lessons and background work count toward your plan usage.</p>
		{CLI_PROVIDERS.map((provider) => {
			const status = statuses.find((s) => s.id === provider.id);
			const pending = busy === provider.id || status?.pending;
			return <div key={provider.id} className="rounded-xl border border-border bg-background/40 p-3" data-testid={`${provider.id}-connection`}>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-2"><span className="font-ui text-sm font-medium">{provider.label}</span>{status?.connected && <CheckCircle2Icon aria-label="Connected" className="size-3.5 text-green-600" />}{pending && <LoaderCircleIcon aria-label="Connecting" className="size-3.5 animate-spin text-muted-foreground" />}</div>
					<div className="flex gap-1.5">
						{status?.connected ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act(provider.id, "disconnect")}>Disconnect</Button> : <Button size="sm" variant="outline" disabled={!!busy || status?.pending} onClick={() => void act(provider.id, "connect")}>Use existing login</Button>}
						{status?.pending ? <Button size="sm" variant="ghost" onClick={() => void act(provider.id, "cancel")}>Cancel</Button> : <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act(provider.id, "login")}>Sign in</Button>}
					</div>
				</div>
				{status?.message && <p role="status" className="mt-2 text-xs leading-relaxed text-muted-foreground">{status.message}</p>}
				{status?.authorizationUrl && <a href={status.authorizationUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs underline underline-offset-4">Continue in browser<ExternalLinkIcon className="size-3" /></a>}
				{status?.enabled && <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={status.allowBackgroundUse} disabled={!!busy || status.pending} onChange={(event) => void act(provider.id, "configure", { allowBackgroundUse: event.target.checked })} />Allow background learning tasks</label>}
				<details className="mt-3 text-xs text-muted-foreground">
					<summary className="cursor-pointer">CLI setup & executable path</summary>
					<p className="mt-2">Already installed? Run <code className="rounded bg-muted px-1">{provider.login}</code> in Terminal, then use your existing login.</p>
					<label className="mt-3 block" htmlFor={`${provider.id}-path`}>Executable path (optional)</label>
					<div className="mt-1 flex gap-2"><input id={`${provider.id}-path`} value={paths[provider.id] ?? status?.binaryPath ?? ""} onChange={(event) => setPaths((previous) => ({ ...previous, [provider.id]: event.target.value }))} placeholder={`Auto-detect ${provider.command}`} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono" /><Button size="sm" variant="outline" disabled={!!busy || status?.pending} onClick={() => void act(provider.id, "refresh")}>Save & refresh</Button></div>
					<p className="mt-2">Disconnect only disables this connection in LearnHarness. Your terminal login is kept.</p>
				</details>
			</div>;
		})}
		{error && <p role="alert" className="text-xs text-red-500">{error}</p>}
	</div>;
}
