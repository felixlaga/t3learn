"use client";

import { useCallback, useEffect, useState } from "react";
import { ZapIcon } from "lucide-react";
import { useServerEvent, useServerResync } from "./server-events";

/**
 * The Claude → Codex notice (owner, 2026-10-30): while Claude is at its
 * usage limit, lessons and background work run on Codex. This line says
 * so, and until when. It hides itself when the limit resets. Wire shape:
 * GET /api/fallback (src/agent/claude-fallback.ts fallbackStatus).
 */
interface Status { limitedUntil: number | null; fallbackModel: string | null }

export function FallbackNotice() {
	const [status, setStatus] = useState<Status | null>(null);
	const refresh = useCallback(async () => {
		try {
			const response = await fetch("/api/fallback", { cache: "no-store" });
			if (response.ok) setStatus(await response.json() as Status);
		} catch { /* the notice is a hint, never a blocker */ }
	}, []);
	useEffect(() => { void refresh(); }, [refresh]);
	useServerEvent("fallback-changed", () => void refresh());
	useServerResync(() => void refresh());
	useEffect(() => {
		if (!status?.limitedUntil) return;
		const timer = setTimeout(() => void refresh(), Math.max(1000, status.limitedUntil - Date.now() + 1000));
		return () => clearTimeout(timer);
	}, [status, refresh]);
	if (!status?.limitedUntil) return null;
	const until = new Date(status.limitedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return <div role="status" data-testid="fallback-notice" className="mx-3 mb-1 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
		<ZapIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
		<span>{status.fallbackModel
			? `Claude reached its usage limit. Lessons use Codex (${status.fallbackModel}) until ${until}.`
			: `Claude reached its usage limit until ${until}. Connect Codex in Providers to keep going.`}</span>
	</div>;
}
