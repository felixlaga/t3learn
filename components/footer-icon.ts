/**
 * The sidebar's bottom row (owner, 2026-10-28): T3 Code's icon-only row.
 * Every control there shares this geometry: a 32px square, muted glyph,
 * accent on hover, the tooltip carries the label. Shared from here so the
 * Progress trigger (components/progress-dialog.tsx), the update button
 * (components/update-pill.tsx) and the sidebar's own entries never drift.
 */
export const FOOTER_ICON_CLASS =
	"flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
