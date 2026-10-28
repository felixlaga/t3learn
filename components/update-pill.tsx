"use client";

/**
 * The update pill (owner, 2026-10-28): the one renderer surface for app
 * updates, sitting at the right end of the sidebar's bottom row next to
 * Settings, where T3 Code keeps its update pill. It is a pure function
 * of the last "lh:update-status" push from electron/main.cjs, seeded by
 * one updateState() read on mount so a push sent before the page loaded
 * is not lost.
 *
 * Hidden while idle or checking. "Update available" downloads on click.
 * "Downloading 42%" while the zip streams in. "Restart to update" asks
 * the shell to swap the bundle and relaunch. "Update failed" retries the
 * step that failed. Browser builds have no window.lh and never render it.
 *
 * Both editions share it: the signed LearnHarness build only ever pushes
 * "downloaded" (electron-updater downloads silently), the local T3Learn
 * build walks through every state.
 */

import { useEffect, useState } from "react";
import { DownloadIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { Hint } from "@/components/ui/hint";

export type UpdateStatus = {
	status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
	version: string | null;
	build?: number | null;
	notes?: string | null;
	percent?: number | null;
	message?: string | null;
	retry?: "check" | "download" | null;
	current?: { version: string; build: number; commit: string } | null;
};

export function UpdatePill() {
	const [state, setState] = useState<UpdateStatus | null>(null);

	useEffect(() => {
		const bridge = window.lh;
		if (!bridge?.onUpdateStatus) return;
		const off = bridge.onUpdateStatus((next) => setState(next));
		// Seed from the shell: a push can predate this mount. A push that
		// already arrived wins over the (older) seed.
		void bridge.updateState?.()
			.then((seed) => { if (seed) setState((prev) => prev ?? seed); })
			.catch(() => {});
		return off;
	}, []);

	if (!state) return null;
	if (state.status === "idle" || state.status === "checking") return null;

	const bridge = window.lh;
	const versionLabel = state.version ? `${state.version}${state.build ? ` (build ${state.build})` : ""}` : "a new build";
	const base = "ml-auto flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider transition-colors";

	if (state.status === "available") {
		return (
			<Hint label={`Download ${versionLabel}`} side="top">
				<button
					type="button"
					data-testid="update-pill"
					data-status="available"
					onClick={() => void bridge?.downloadUpdate?.()}
					className={`${base} bg-accent text-foreground hover:bg-accent/70`}
				>
					<DownloadIcon className="size-3" />
					Update available
				</button>
			</Hint>
		);
	}

	if (state.status === "downloading") {
		const percent = typeof state.percent === "number" ? `${state.percent}%` : "…";
		return (
			<span
				data-testid="update-pill"
				data-status="downloading"
				aria-live="polite"
				className={`${base} text-muted-foreground`}
			>
				<DownloadIcon className="size-3 animate-pulse" />
				Downloading {percent}
			</span>
		);
	}

	if (state.status === "downloaded") {
		return (
			<Hint label={`Install ${versionLabel} and relaunch`} side="top">
				<button
					type="button"
					data-testid="update-pill"
					data-status="downloaded"
					onClick={() => bridge?.installUpdate?.()}
					className={`${base} bg-accent text-foreground hover:bg-accent/70`}
				>
					<RefreshCwIcon className="size-3" />
					Restart to update
				</button>
			</Hint>
		);
	}

	// error: the step that failed is retried on click.
	const retry = () => {
		if (state.retry === "check") void bridge?.checkForUpdate?.();
		else void bridge?.downloadUpdate?.();
	};
	return (
		<Hint label={state.message ? `${state.message}. Click to retry.` : "Click to retry"} side="top">
			<button
				type="button"
				data-testid="update-pill"
				data-status="error"
				onClick={retry}
				className={`${base} text-amber-400 hover:bg-accent hover:text-amber-300`}
			>
				<TriangleAlertIcon className="size-3" />
				Update failed
			</button>
		</Hint>
	);
}
