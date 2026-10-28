"use client";

/**
 * The update button (owner, 2026-10-28; round icon since the T3 Code row
 * the same day): the one renderer surface for app updates, at the right
 * end of the sidebar's bottom row where T3 Code keeps its update control.
 * It is a pure function of the last "lh:update-status" push from
 * electron/main.cjs, seeded by one updateState() read on mount so a push
 * sent before the page loaded is not lost.
 *
 * Always visible in the desktop app, like T3 Code's: a circular arrow with
 * a small badge in its corner that says the state. Up to date = a check,
 * click checks again. Available = a down arrow in the accent, click
 * downloads. Downloading = the arrow spins, the tooltip carries the
 * percentage. Downloaded = an accent check, click restarts into the new
 * build. Failed = an amber warning, click retries the step that failed.
 * The wording of each state rides the tooltip and a visually hidden label
 * so screen readers and tests read the same words as before.
 *
 * Browser builds have no window.lh and never render it. Both editions
 * share it: the signed LearnHarness build only ever pushes "downloaded"
 * (electron-updater downloads silently), the local T3Learn build walks
 * through every state.
 */

import { useEffect, useState } from "react";
import { ArrowDownIcon, CheckIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { FOOTER_ICON_CLASS } from "@/components/footer-icon";

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

/** The badge in the button's corner: one glyph per state, sized to sit
 *  on the circular arrow without hiding it. */
function Badge({ status }: { status: UpdateStatus["status"] }) {
	const base = "absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border border-background";
	switch (status) {
		case "available":
			return <span className={cn(base, "bg-foreground text-background")}><ArrowDownIcon className="size-2.5" strokeWidth={3} /></span>;
		case "downloaded":
			return <span className={cn(base, "bg-foreground text-background")}><CheckIcon className="size-2.5" strokeWidth={3} /></span>;
		case "error":
			return <span className={cn(base, "bg-amber-400 text-background")}><TriangleAlertIcon className="size-2.5" strokeWidth={3} /></span>;
		case "idle":
			return <span className={cn(base, "bg-muted text-muted-foreground")}><CheckIcon className="size-2.5" strokeWidth={3} /></span>;
		default:
			return null; // checking / downloading: the spinning arrow is the signal
	}
}

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

	const bridge = window.lh;
	const versionLabel = state.version ? `${state.version}${state.build ? ` (build ${state.build})` : ""}` : "a new build";
	const percent = typeof state.percent === "number" ? `${state.percent}%` : "…";

	/** Per state: the words (tooltip + hidden label), the click, and
	 *  whether the arrow spins. */
	const view = (() => {
		switch (state.status) {
			case "available":
				return { label: "Update available", hint: `Download ${versionLabel}`, onClick: () => void bridge?.downloadUpdate?.(), spin: false };
			case "downloading":
				return { label: `Downloading ${percent}`, hint: `Downloading ${versionLabel}: ${percent}`, onClick: undefined, spin: true };
			case "downloaded":
				return { label: "Restart to update", hint: `Install ${versionLabel} and relaunch`, onClick: () => bridge?.installUpdate?.(), spin: false };
			case "error":
				return {
					label: "Update failed",
					hint: state.message ? `${state.message}. Click to retry.` : "Update failed. Click to retry.",
					onClick: () => { if (state.retry === "check") void bridge?.checkForUpdate?.(); else void bridge?.downloadUpdate?.(); },
					spin: false,
				};
			case "checking":
				return { label: "Checking for updates", hint: "Checking for updates…", onClick: undefined, spin: true };
			default:
				return { label: "Up to date", hint: "Up to date. Click to check for updates.", onClick: () => void bridge?.checkForUpdate?.(), spin: false };
		}
	})();

	const accent = state.status === "available" || state.status === "downloaded";
	return (
		<Hint label={view.hint} side="top">
			<button
				type="button"
				data-testid="update-pill"
				data-status={state.status}
				aria-label={view.label}
				aria-live={state.status === "downloading" ? "polite" : undefined}
				disabled={view.onClick === undefined}
				onClick={view.onClick}
				className={cn(
					FOOTER_ICON_CLASS,
					"relative ml-auto rounded-full disabled:cursor-default disabled:hover:bg-transparent",
					accent && "text-foreground",
					state.status === "error" && "text-amber-400 hover:text-amber-300",
				)}
			>
				<RefreshCwIcon className={cn("size-4", view.spin && "animate-spin")} />
				<Badge status={state.status} />
				<span className="sr-only">{view.label}</span>
			</button>
		</Hint>
	);
}
