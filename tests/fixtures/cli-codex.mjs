#!/usr/bin/env node
import { createInterface } from "node:readline";
let tools = [];
function send(frame) { process.stdout.write(JSON.stringify(frame) + "\n"); }
createInterface({ input: process.stdin }).on("line", (line) => {
	const { id, method, params } = JSON.parse(line);
	if (method === "initialize") send({ id, result: {} });
	if (method === "account/read") send({ id, result: { account: { type: "chatgpt" } } });
	if (method === "model/list") send({ id, result: { data: [{ id: "fixture", model: "fixture", displayName: "Fixture CLI", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }], nextCursor: null } });
	if (method === "config/read") send({ id, result: { config: { mcp_servers: { outside: { command: "must-not-run" } } } } });
	if (method === "thread/start") {
		if (params.config.mcp_servers.outside.enabled !== false || params.config["features.shell_tool"] !== false) { send({ id, error: { message: "Unrestricted runtime" } }); return; }
		tools = params.dynamicTools; send({ id, result: { thread: { id: "fixture-thread" } } });
	}
	if (method === "turn/start") {
		send({ id, result: { turn: { id: "fixture-turn" } } });
		const prompt = params.input[0].text;
		if (prompt.includes("HANG")) return;
		if (prompt.includes("FAIL")) { send({ method: "turn/completed", params: { turn: { status: "failed", error: { message: "private-token-not-for-renderer" } } } }); return; }
		if (prompt.includes("EXIT")) { process.exit(1); }
		send({ method: "thread/tokenUsage/updated", params: { tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 5, totalTokens: 105 } } } });
		if (tools.length && !prompt.includes('"role":"toolResult"')) {
			send({ id: "tool-request", method: "item/tool/call", params: { tool: tools[0].name, callId: "fixture-call", arguments: { answer: 42 } } }); return;
		}
		send({ method: "item/agentMessage/delta", params: { delta: "The answer is 42." } });
		send({ method: "turn/completed", params: { turn: { status: "completed" } } });
	}
	if (method === "account/login/start") send({ id, result: { authUrl: "https://auth.openai.com/authorize?state=fixture", loginId: "fixture-login" } });
});
