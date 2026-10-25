import { isCliProvider } from "../core/contracts/cli-providers.ts";
import { cliConnected, cliBackgroundAllowed, cliScopeCurrent, onCliChange } from "./cli-providers.ts";
import { chatGPTBackgroundAllowed, chatGPTConnected, chatGPTScopeCurrent, onChatGPTChange } from "./chatgpt-bridge.ts";
import { nativeSubscriptionId, nativeSubscriptionConnected, nativeSubscriptionBackgroundAllowed, nativeAdmissionCurrent, onNativeSubscriptionChange } from "./subscription-bridge.ts";
import type { AdmissionScope } from "./subscription-request-cycle.ts";

export function isSubscriptionProvider(provider: string | undefined): boolean { return isCliProvider(provider) || provider === "chatgpt" || !!(provider && nativeSubscriptionId(provider)); }
export function subscriptionConnected(provider: string): boolean {
	if (isCliProvider(provider)) return cliConnected(provider);
	if (provider === "chatgpt") return chatGPTConnected();
	const native = nativeSubscriptionId(provider); return !!native && nativeSubscriptionConnected(native);
}
/** Ordinary API connections have no subscription background-consent gate. */
export function connectionBackgroundAllowed(provider: string | undefined): boolean {
	if (isCliProvider(provider)) return cliBackgroundAllowed(provider);
	if (provider === "chatgpt") return chatGPTBackgroundAllowed();
	const native = provider ? nativeSubscriptionId(provider) : undefined;
	return native ? nativeSubscriptionBackgroundAllowed(native) : true;
}
export function connectionScopeCurrent(provider: string, scope: AdmissionScope): boolean {
	if (isCliProvider(provider)) return cliScopeCurrent(provider, scope);
	if (provider === "chatgpt") return chatGPTScopeCurrent(scope);
	const native = nativeSubscriptionId(provider); return !!native && nativeAdmissionCurrent(native, scope);
}
export function onSubscriptionChange(listener: () => void): () => void {
	const stopCli = onCliChange(listener);
	const stopChatGPT = onChatGPTChange(listener), stopNative = onNativeSubscriptionChange(listener);
	return () => { stopChatGPT(); stopNative(); stopCli(); };
}
