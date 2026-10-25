"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Adapted from T3 Code's ComposerSurface (MIT, T3 Tools Inc.).
// See docs/t3-code-attribution.md for the pinned source and license.
export function ComposerSurface({ className, ...props }: ComponentProps<"div">) {
	return <div data-slot="composer-shell" className={cn(
		"pointer-events-auto relative isolate w-full rounded-3xl border border-border/60 bg-card shadow-[0_8px_32px_-12px_rgb(0_0_0/35%)] transition-shadow focus-within:border-muted-foreground/40",
		className,
	)} {...props} />;
}
