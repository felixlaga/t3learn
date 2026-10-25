#!/usr/bin/env node
// Real Agent SDK transport, deterministic CLI peer: no account or network access.
import { createInterface } from "node:readline";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const usage = { input_tokens: 80, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 };
createInterface({ input: process.stdin }).on("line", (line) => {
	const frame = JSON.parse(line);
	if (frame.type === "control_request") {
		const result = frame.request.subtype === "initialize" ? { commands: [], output_style: "default", available_output_styles: ["default"], account: { subscriptionType: "max", apiKeySource: "none", apiProvider: "firstParty" }, models: [{ value: "fixture", displayName: "Fixture Claude", description: "Fixture" }] } : {};
		send({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: result } });
	}
	if (frame.type === "user") {
		const prompt = JSON.stringify(frame.message.content);
		if (prompt.includes("HANG")) return;
		if (prompt.includes("EXIT")) process.exit(1);
		const isTool = prompt.includes("CHECK") && !prompt.includes("toolResult");
		const content = isTool ? [{ type: "tool_use", id: "claude-fixture-call", name: "mcp__learnharness__learning_check", input: { answer: 42 } }] : [{ type: "text", text: "The answer is 42." }];
		send({ type: "assistant", session_id: "fixture-session", parent_tool_use_id: null, uuid: "fixture-message", message: { id: "fixture-message", type: "message", role: "assistant", model: "fixture", content, stop_reason: isTool ? "tool_use" : "end_turn", stop_sequence: null, usage } });
		if (!isTool) send({ type: "result", subtype: "success", is_error: false, result: "The answer is 42.", session_id: "fixture-session", uuid: "fixture-result", usage, num_turns: 1, duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, modelUsage: {}, permission_denials: [] });
	}
});
