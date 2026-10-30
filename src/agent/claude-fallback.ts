/**
 * CLAUDE → CODEX FALLBACK (owner, 2026-10-30): when the Claude
 * subscription reports its usage limit, every model call that would go
 * to Claude Code goes to the Codex CLI instead, and comes back to Claude
 * once the limit resets. The failed call itself is rerun on Codex, so a
 * lesson continues mid-turn. Lessons and background work follow the same
 * rule. A server event tells the sidebar to show the notice.
 *
 * The limit is learned from the Claude Agent SDK: a rate_limit_event with
 * status "rejected" (with its reset time when the SDK sends one), or a
 * usage-limit error. Without a reset time Claude is retried after
 * DEFAULT_PAUSE_MS.
 *
 * The fallback model is the first model the Codex CLI lists (its own
 * default), at the same thinking level as the Claude spec it replaces
 * (clamped by piEngineForSpec). Nothing falls back when Codex is not
 * connected; the call fails as before.
 *
 * Process-wide state on globalThis: Next compiles each route entry as its
 * own module instance (the cli-providers precedent).
 */

import type { Api, AssistantMessageEvent, Model, StreamFunction } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { emit } from "../core/events.ts";
import { cliBackgroundAllowed, cliConnected, cliModels } from "./cli-providers.ts";
import type { SubscriptionDispatchLifecycle } from "./subscription-request-cycle.ts";

export const DEFAULT_PAUSE_MS = 15 * 60_000;
const PRIMARY = "claude-code";
const FALLBACK = "codex-cli";

const KEY = Symbol.for("lh.claude.fallback");
const globals = globalThis as typeof globalThis & { [KEY]?: { limitedUntil: number; timer?: ReturnType<typeof setTimeout> } };
const state = globals[KEY] ??= { limitedUntil: 0 };

/** Record that Claude refused for its usage limit. `resetsAt` is the
 *  SDK's reset time (seconds or milliseconds since the epoch). */
export function noteClaudeLimited(resetsAt?: number, now = Date.now()): void {
	const until = resetsAt && Number.isFinite(resetsAt) ? (resetsAt < 1e12 ? resetsAt * 1000 : resetsAt) : now + DEFAULT_PAUSE_MS;
	if (until <= now) return;
	const changed = Math.abs(until - state.limitedUntil) > 1000;
	state.limitedUntil = until;
	if (!changed) return;
	if (state.timer) clearTimeout(state.timer);
	state.timer = setTimeout(() => emit("fallback-changed", {}), Math.min(until - now + 500, 2 ** 31 - 1));
	state.timer.unref?.();
	emit("fallback-changed", {});
}

/** Clear the limit (tests; a successful Claude call is not needed — the
 *  limit simply expires). */
export function resetClaudeLimit(): void {
	if (state.timer) clearTimeout(state.timer);
	state.limitedUntil = 0; state.timer = undefined;
}

export function claudeLimitedUntil(now = Date.now()): number | null {
	return state.limitedUntil > now ? state.limitedUntil : null;
}

/** The Codex model that stands in for Claude, when Codex is connected. */
export function codexFallbackModel(background: boolean): Model<Api> | undefined {
	if (!cliConnected(FALLBACK) || (background && !cliBackgroundAllowed(FALLBACK))) return undefined;
	return cliModels().find((m) => m.provider === FALLBACK);
}

/** What the sidebar notice shows. */
export function fallbackStatus(now = Date.now()): { limitedUntil: number | null; fallbackModel: string | null } {
	const until = claudeLimitedUntil(now);
	const model = until ? codexFallbackModel(false) : undefined;
	return { limitedUntil: until, fallbackModel: model ? model.name || model.id : null };
}

/** Recognize the usage-limit error text the CLI stream produces. */
export function isUsageLimitError(text: string): boolean {
	return /usage limit|rate.?limit|\b429\b|quota/i.test(text);
}

export interface FallbackStream {
	/** The fallback call, given the lifecycle it may use (undefined once
	 *  the Claude call already dispatched for this model call). */
	run(lifecycle: SubscriptionDispatchLifecycle | undefined): ReturnType<StreamFunction>;
}

/**
 * Wrap one Claude call. Two paths:
 *   - Claude is already known to be limited: go straight to Codex, which
 *     owns the request's lifecycle (it is the call that dispatches).
 *   - Otherwise call Claude. If Claude dispatched and then failed for its
 *     limit before any content, rerun the same request on Codex. The
 *     request cycle already counts this call as dispatched, so the Codex
 *     call runs without the lifecycle.
 * Anything else passes through unchanged.
 */
export function claudeWithFallback(
	primary: (lifecycle: SubscriptionDispatchLifecycle | undefined) => ReturnType<StreamFunction>,
	fallback: () => FallbackStream | undefined,
	lifecycle: SubscriptionDispatchLifecycle | undefined,
): ReturnType<StreamFunction> {
	if (claudeLimitedUntil()) {
		const direct = fallback();
		if (direct) return direct.run(lifecycle);
	}
	let dispatched = false;
	const tracked: SubscriptionDispatchLifecycle | undefined = lifecycle && {
		captured: (scope) => lifecycle.captured(scope),
		beforeDispatch: (scope) => { lifecycle.beforeDispatch(scope); dispatched = true; },
		noDispatch: (kind) => lifecycle.noDispatch(kind),
	};
	const out = new AssistantMessageEventStream();
	void (async () => {
		const held: AssistantMessageEvent[] = [];
		let passing = false;
		try {
			for await (const event of primary(tracked ?? undefined)) {
				if (passing) { out.push(event); continue; }
				if (event.type === "start") { held.push(event); continue; }
				if (event.type === "error" && event.reason === "error" && (dispatched || !lifecycle) && event.error.content.length === 0
					&& (claudeLimitedUntil() || isUsageLimitError(event.error.errorMessage ?? ""))) {
					if (!claudeLimitedUntil()) noteClaudeLimited();
					const second = fallback();
					if (second) {
						for await (const replacement of second.run(undefined)) out.push(replacement);
						return;
					}
				}
				passing = true;
				for (const h of held.splice(0)) out.push(h);
				out.push(event);
			}
			for (const h of held.splice(0)) out.push(h);
		} finally {
			out.end();
		}
	})();
	return out;
}

/** Is this spec one the fallback covers? */
export function fallsBack(provider: string): boolean {
	return provider === PRIMARY;
}
