/**
 * README DEMO DATA (2026-10-29). Builds a scratch data folder for the README
 * screenshots: fifteen sessions, a knowledge graph of about 380
 * propositions from the topic files in ./topics, and one full teaching
 * session (gradient descent) waiting on a prediction.
 *
 *   npx tsx scripts/readme-demo/seed.mts /tmp/t3learn-readme
 *
 * Then run the app against it (LH_DATA_DIR=<dir> LH_AUTH_FILE=<dir>/auth.json
 * LH_IGNORE_ENV_KEYS=1). The Anthropic key it writes is a placeholder: no
 * model is ever called, and every message is marked as already extracted
 * so no background job starts.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { coverageSlots } from "../../src/core/coverage.ts";
import type { LhMessage } from "../../src/core/native-messages.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: seed.mts <data dir>");
const here = path.dirname(new URL(import.meta.url).pathname);

const NOW = Date.now();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const iso = (t: number) => new Date(t).toISOString();
const hex = (n: number) => crypto.randomBytes(n).toString("hex");
const chatId = (t: number) => `chat_${t.toString(36)}_${hex(4)}`;
const msgId = (t: number) => `msg_${t.toString(36)}_${hex(4)}`;
const callId = () => `toolu_${hex(12)}`;

const MODEL = { provider: "anthropic", id: "claude-opus-5-5" };
const TURN_MODEL = `${MODEL.provider}:${MODEL.id}`;

interface Topic { title: string; nodes: { key: string; name: string; statement: string }[]; chains: { premises: string[]; conclusion: string }[] }
interface Session { slug?: string; title: string; ago: number; kind?: "practice"; settledAgo?: number; ask: string; reply: string }

// ─── the sessions (newest first; the hero is built separately) ────────────────

const SESSIONS: Session[] = [
	{ slug: "transformers", title: "Transformers and attention", ago: 2 * HOUR, ask: "How does attention actually work in a transformer?", reply: "We built attention from a lookup table that blends instead of picking: queries score keys, softmax turns scores into weights, and the output is the weighted mix of values. Multi-head attention runs several of these in parallel subspaces, and positional encodings give order back to a mechanism that is otherwise blind to it." },
	{ title: "Practice: conditional probability", ago: 5 * HOUR, kind: "practice", ask: "Practice conditional probability with me.", reply: "Three problems done. You set up P(A|B) cleanly every time and caught the base-rate trap in the screening problem on your own. The one slip was treating two draws without replacement as independent. We retested it on a fresh surface and you got it." },
	{ slug: "neural-networks", title: "Neural networks from scratch", ago: 1 * DAY + 2 * HOUR, ask: "Teach me neural networks from scratch.", reply: "From a single neuron as a weighted sum through a nonlinearity, to layers as function composition, to backpropagation as the chain rule applied in reverse order. The key click: without the nonlinearity, any depth collapses to one linear map." },
	{ slug: "bayes", title: "Bayes' theorem from scratch", ago: 1 * DAY + 7 * HOUR, ask: "I want Bayes' theorem to feel obvious, not memorized.", reply: "We derived Bayes from the two ways of writing P(A and B), then made it concrete with natural frequencies. A rare disease and an accurate test still give mostly false positives, because the prior decides how many true cases there are to find." },
	{ slug: "entropy", title: "Entropy and the second law", ago: 2 * DAY + 3 * HOUR, ask: "Why does entropy always increase?", reply: "Entropy counts microstates: S = k ln W. The second law is then a statement about overwhelming odds, since macrostates with more microstates are vastly more likely, and an isolated system wanders toward them." },
	{ slug: "raft", title: "Raft consensus", ago: 3 * DAY + 1 * HOUR, ask: "Explain how Raft keeps replicas consistent.", reply: "Leader election by randomized timeouts and majority votes, log replication with a consistency check on the previous entry, and commitment once a majority stores an entry. Terms act as a logical clock that makes stale leaders step down." },
	{ slug: "isolation", title: "Database isolation levels", ago: 3 * DAY + 6 * HOUR, ask: "What do isolation levels actually guarantee?", reply: "Each level is defined by the anomalies it forbids. Read committed stops dirty reads, repeatable read stops non-repeatable reads, and only serializable rules out write skew, which snapshot isolation still allows." },
	{ slug: "relativity", title: "Special relativity", ago: 4 * DAY + 2 * HOUR, ask: "Teach me special relativity from the two postulates.", reply: "From the constancy of c and the relativity principle we derived time dilation with a light clock, then length contraction, then the relativity of simultaneity. The Lorentz factor γ = 1/√(1 − v²/c²) ties them together." },
	{ slug: "fourier", title: "Fourier series intuition", ago: 5 * DAY + 4 * HOUR, ask: "Why can any periodic function be built from sines?", reply: "Sines and cosines at integer frequencies are orthogonal, so each coefficient is a projection, the same way a vector's components are dot products with basis vectors. Square waves need infinitely many terms, and the overshoot at jumps never fully disappears." },
	{ slug: "hume", title: "Hume on causation", ago: 6 * DAY + 3 * HOUR, ask: "What was Hume's problem with causation?", reply: "Hume argues that we never observe a necessary connection, only constant conjunction. Our expectation that the future resembles the past comes from custom, not reason, and any argument for it would assume what it tries to prove." },
	{ slug: "sky-blue", title: "Why is the sky blue?", ago: 8 * DAY, ask: "Why is the sky blue and not violet?", reply: "Molecules much smaller than the wavelength scatter light in proportion to 1/λ⁴, so blue scatters far more than red. Violet scatters even more, but sunlight has less of it, some is absorbed high up, and our eyes are less sensitive to it." },
	{ slug: "natural-selection", title: "Natural selection", ago: 12 * DAY, ask: "How does natural selection produce complex adaptations?", reply: "Variation, heredity and differential reproduction are enough. Small advantages compound over many generations, and each step only has to be better than what came before, not designed toward an end." },
	{ slug: "limits", title: "What a limit really says", ago: 9 * DAY, settledAgo: 6 * DAY, ask: "What does the epsilon-delta definition of a limit actually say?", reply: "A limit is a promise you can always keep: for any tolerance ε around L, there is a closeness δ around a that keeps f(x) within it. The definition never mentions reaching a." },
	{ slug: "halting", title: "The halting problem", ago: 14 * DAY, settledAgo: 10 * DAY, ask: "Why can't a program decide whether another program halts?", reply: "Assume a decider H exists, build a program that does the opposite of whatever H predicts about itself, and run it on its own code. Either answer contradicts H, so no such H can exist." },
];

// ─── message builders ─────────────────────────────────────────────────────────


function user(text: string, t: number): LhMessage {
	return { id: msgId(t), role: "user", content: text, timestamp: t } as unknown as LhMessage;
}
function assistant(content: unknown[], t: number, stop: "stop" | "toolUse"): LhMessage {
	return {
		id: msgId(t), role: "assistant", api: "anthropic-messages", provider: MODEL.provider, model: MODEL.id, content,
		stopReason: stop, timestamp: t, thinkingLevel: "high",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	} as unknown as LhMessage;
}
function toolResult(id: string, name: string, text: string, details: unknown, t: number): LhMessage {
	return { id: msgId(t), role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], details, isError: false, timestamp: t } as unknown as LhMessage;
}

interface Question {
	tool: "quiz" | "probe";
	type?: "predict" | "check";
	nodeId?: string;
	question: string;
	details?: string;
	options: [string, string][];
	correct: string;
	explanation: string;
}
interface Answer { value: string; confidence: number; thinking?: string }

/** One assistant turn of prose ending in a question, plus the learner's answer
 *  (omit `answer` to leave the question open). */
function ask(messages: LhMessage[], prose: string, q: Question, t: number, answer?: Answer) {
	const id = callId();
	const args = { ...(q.type ? { type: q.type } : {}), ...(q.nodeId ? { nodeId: q.nodeId } : {}), question: q.question, ...(q.details ? { details: q.details } : {}), options: q.options.map(([label, value]) => ({ label, value })), explanation: q.explanation, correctAnswer: q.correct };
	const msg = assistant([{ type: "text", text: prose }, { type: "toolCall", id, name: q.tool, arguments: args }], t, "toolUse");
	messages.push(msg);
	if (!answer) return msg;
	const options = q.options.map(([label], i) => ({ index: i + 1, label }));
	const pickIndex = q.options.findIndex(([, v]) => v === answer.value) + 1;
	const label = q.options[pickIndex - 1][0];
	const correct = answer.value === q.correct;
	const answeredAt = t + 70_000;
	const summary = { kind: "quiz", answers: [{ index: pickIndex, label }], correct, confidence: answer.confidence, ...(answer.thinking ? { thinking: answer.thinking } : {}) };
	messages.push(toolResult(id, q.tool, JSON.stringify(summary), {
		kind: "quiz", tool: q.tool, ...(q.type ? { questionType: q.type } : {}), questionText: q.question, options, dontKnow: false,
		answers: [{ label, value: answer.value, index: pickIndex }], ...(answer.thinking ? { thinking: answer.thinking } : {}),
		answeredAt: iso(answeredAt), correctIndices: [q.options.findIndex(([, v]) => v === q.correct) + 1], explanation: q.explanation, correct, confidence: answer.confidence,
	}, answeredAt));
	return msg;
}

// ─── the hero lesson: gradient descent ────────────────────────────────────────

const PLAN = {
	nodes: [
		{ id: "gd-step", title: "The GD step" },
		{ id: "convexity", title: "Convexity: gradient 0 means global min" },
		{ id: "local-quad", title: "Local model: everything looks quadratic" },
		{ id: "gd-quad", title: "GD on a quadratic: a linear iteration" },
		{ id: "eigen", title: "Decouple along eigenvectors" },
		{ id: "converge", title: "Convergence iff 0 < α < 2/λ_max" },
		{ id: "overshoot", title: "Overshoot and zigzag" },
		{ id: "rate", title: "Rate 1 − 1/κ" },
		{ id: "lipschitz", title: "Lipschitz: a bound on slope" },
		{ id: "smooth", title: "Smooth: a bound on curvature" },
		{ id: "beyond", title: "Beyond quadratics: α < 2/L" },
		{ id: "sgd", title: "Gradient as expectation: minibatch noise" },
		{ id: "momentum", title: "Momentum kills zigzag" },
		{ id: "real", title: "Reading real training curves" },
	],
	edges: [
		["gd-step", "gd-quad"], ["local-quad", "gd-quad"], ["convexity", "beyond"], ["gd-quad", "eigen"], ["eigen", "converge"],
		["converge", "overshoot"], ["converge", "rate"], ["overshoot", "momentum"], ["rate", "momentum"], ["lipschitz", "smooth"],
		["smooth", "beyond"], ["converge", "beyond"], ["gd-step", "sgd"], ["beyond", "sgd"], ["sgd", "real"], ["momentum", "real"], ["beyond", "real"],
	].map(([from, to]) => ({ from, to })),
	version: 1,
};

function heroMessages(start: number) {
	const m: LhMessage[] = [];
	let t = start;
	const step = (minutes: number) => (t += minutes * MIN);
	m.push(user("Teach me gradient descent properly. I can run it, but I want to understand why it converges and when it doesn't.", t));

	step(0.5);
	ask(m, "You can already run it, so the measurement is about the reasons underneath. First strand: what the gradient tells you locally.", {
		tool: "probe",
		question: "At a point $\\mathbf{x}$, in which direction does a small step decrease $f$ fastest?",
		options: [["Along $-\\nabla f(\\mathbf{x})$", "neg-grad"], ["Along $\\nabla f(\\mathbf{x})$", "grad"], ["Toward the nearest minimum", "nearest-min"], ["It depends on the learning rate", "depends-lr"]],
		correct: "neg-grad",
		explanation: "The directional derivative along a unit vector $\\mathbf{u}$ is $\\nabla f \\cdot \\mathbf{u}$, which is most negative when $\\mathbf{u}$ points along $-\\nabla f$.",
	}, t, { value: "neg-grad", confidence: 95, thinking: "Gradient points uphill so minus it is downhill." });

	step(1.5);
	ask(m, "Solid, and at high confidence. The ceiling is probably in the step size, so that is where the next question sits.", {
		tool: "probe",
		question: "On $f(x) = \\tfrac{\\lambda}{2}x^2$, gradient descent uses $x \\leftarrow x - \\alpha f'(x)$. For which step sizes does it converge?",
		options: [["Any $\\alpha > 0$, since every step goes downhill", "any"], ["$0 < \\alpha < 2/\\lambda$", "two-over-lambda"], ["$0 < \\alpha < 1/\\lambda$", "one-over-lambda"], ["Only $\\alpha = 1/\\lambda$", "exact"]],
		correct: "two-over-lambda",
		explanation: "The update is $x \\leftarrow (1 - \\alpha\\lambda)x$, which shrinks exactly when $|1 - \\alpha\\lambda| < 1$, that is $0 < \\alpha < 2/\\lambda$.",
	}, t, { value: "any", confidence: 60, thinking: "If you always step against the gradient you go down, so it should work, maybe slowly." });

	step(1.5);
	const done = callId();
	m.push(assistant([
		{ type: "text", text: "That is the edge. You trust the direction, but you picture each step as small enough to stay downhill, and the step size is exactly where that breaks. The lesson will build from the one-dimensional quadratic up." },
		{ type: "toolCall", id: done, name: "probe_done", arguments: { assessment: { strands: [
			{ strand: "Local geometry of the gradient", assessment: "Floor: steepest descent along $-\\nabla f$, held at 95%. Build from it." },
			{ strand: "Step size and stability", assessment: "Ceiling: believes any positive step converges. Misconception: overshoot is invisible to him. Start from the 1D quadratic." },
			{ strand: "Stochastic gradients", assessment: "Uses minibatches in practice with no model of why the noise averages out." },
		] } } },
	], t, "toolUse"));
	m.push(toolResult(done, "probe_done", "Assessment recorded.", { ok: true }, t + 1000));
	m.push({ id: `steer_probe_${hex(4)}`, role: "custom", customType: "probe-handoff", content: "Next: plan the full teaching arc from my current understanding to the goal understanding.", display: true, details: {}, timestamp: t + 2000 } as unknown as LhMessage);

	step(2);
	const plan = callId();
	m.push(assistant([
		{ type: "text", text: "Here is the plan. Everything rests on one picture: near a minimum every smooth loss looks like a bowl, and on a bowl gradient descent is a linear iteration you can solve exactly. Convergence, the step-size limit, zigzag and minibatch noise all fall out of that picture." },
		{ type: "toolCall", id: plan, name: "plan_init", arguments: { nodes: PLAN.nodes, edges: PLAN.edges } },
	], t, "toolUse"));
	m.push(toolResult(plan, "plan_init", JSON.stringify({ ok: true, nodeIds: PLAN.nodes.map((n) => n.id) }), { ok: true, tree: PLAN }, t + 1000));
	m.push({ id: `pb_${t.toString(36)}_${hex(4)}`, role: "custom", customType: "plan-block", content: "", display: true, details: { planCallId: plan, block: { kind: "full", at: iso(t + 1500), current: null, nodes: PLAN.nodes.map((n) => ({ ...n, status: "upcoming" })), edges: PLAN.edges } }, timestamp: t + 1500 } as unknown as LhMessage);

	const checks: [string, string, Question, Answer][] = [
		["gd-step", "One step of gradient descent moves against the gradient by a fixed fraction: $\\mathbf{x} \\leftarrow \\mathbf{x} - \\alpha \\nabla f(\\mathbf{x})$. The learning rate $\\alpha$ sets how far.",
			{ tool: "quiz", type: "check", nodeId: "gd-step", question: "With $f(x) = x^2$, $x = 3$ and $\\alpha = 0.1$, where does one step land?", options: [["$x = 2.4$", "2.4"], ["$x = 2.7$", "2.7"], ["$x = 3.6$", "3.6"]], correct: "2.4", explanation: "$f'(3) = 6$, so $x \\leftarrow 3 - 0.1 \\cdot 6 = 2.4$." },
			{ value: "2.4", confidence: 90 }],
		["local-quad", "Zoom in on any smooth minimum and the loss looks like a bowl: $f(\\mathbf{x}) \\approx f(\\mathbf{x}^*) + \\tfrac12 (\\mathbf{x}-\\mathbf{x}^*)^\\top H (\\mathbf{x}-\\mathbf{x}^*)$. The gradient term vanishes because the gradient is zero at the minimum.",
			{ tool: "quiz", type: "check", nodeId: "local-quad", question: "Why is there no linear term in the expansion around a minimum?", options: [["The gradient is zero there", "zero-grad"], ["Linear terms are too small to matter", "small"], ["The Hessian absorbs it", "absorbed"]], correct: "zero-grad", explanation: "The linear term is $\\nabla f(\\mathbf{x}^*)^\\top(\\mathbf{x}-\\mathbf{x}^*)$, and $\\nabla f(\\mathbf{x}^*) = 0$." },
			{ value: "zero-grad", confidence: 80 }],
		["gd-quad", "On that bowl the gradient is $H(\\mathbf{x}-\\mathbf{x}^*)$, so the error $\\mathbf{e} = \\mathbf{x}-\\mathbf{x}^*$ updates as $\\mathbf{e} \\leftarrow (I - \\alpha H)\\mathbf{e}$. Gradient descent is a matrix applied over and over.",
			{ tool: "quiz", type: "check", nodeId: "gd-quad", question: "After $k$ steps, what is the error?", options: [["$(I - \\alpha H)^k \\mathbf{e}_0$", "power"], ["$(I - k\\alpha H)\\mathbf{e}_0$", "linear"], ["$e^{-\\alpha k H}\\mathbf{e}_0$ exactly", "exp"]], correct: "power", explanation: "Each step multiplies by the same matrix, so $k$ steps multiply by its $k$-th power." },
			{ value: "power", confidence: 75 }],
		["eigen", "In the eigenbasis of $H$ the matrix is diagonal, so each direction evolves alone: the component along eigenvector $i$ is multiplied by $1 - \\alpha\\lambda_i$ every step.",
			{ tool: "quiz", type: "check", nodeId: "eigen", question: "Along an eigenvector with $\\lambda = 4$ and $\\alpha = 0.4$, what happens to that component each step?", options: [["It is multiplied by $-0.6$: it flips sign and shrinks", "flip-shrink"], ["It is multiplied by $0.6$", "shrink"], ["It grows", "grow"]], correct: "flip-shrink", explanation: "$1 - 0.4 \\cdot 4 = -0.6$. The sign flips each step and the size shrinks by 0.6." },
			{ value: "flip-shrink", confidence: 70, thinking: "1 - 1.6 is negative so it bounces" }],
		["converge", "Every factor must satisfy $|1 - \\alpha\\lambda_i| < 1$. The steepest direction, $\\lambda_{\\max}$, gives the tightest limit: convergence holds exactly when $0 < \\alpha < 2/\\lambda_{\\max}$. That is the answer to your probe miss: a positive step is not enough.",
			{ tool: "quiz", type: "check", nodeId: "converge", question: "$H$ has eigenvalues 1 and 10. Which step size diverges?", options: [["$\\alpha = 0.25$", "0.25"], ["$\\alpha = 0.15$", "0.15"], ["$\\alpha = 0.05$", "0.05"]], correct: "0.25", explanation: "$2/\\lambda_{\\max} = 0.2$. At $0.25$ the factor along $\\lambda = 10$ is $-1.5$." },
			{ value: "0.25", confidence: 85 }],
		["overshoot", "Between $1/\\lambda$ and $2/\\lambda$ the factor is negative: the iterate jumps past the minimum and comes back from the other side. In a long narrow valley that bouncing is the zigzag you see in training.",
			{ tool: "quiz", type: "check", nodeId: "overshoot", question: "A run zigzags across a valley but still converges. What is true of the steep direction?", options: [["$1/\\lambda < \\alpha < 2/\\lambda$ there", "between"], ["$\\alpha > 2/\\lambda$ there", "above"], ["$\\alpha < 1/\\lambda$ there", "below"]], correct: "between", explanation: "A negative factor with size below one bounces and still shrinks." },
			{ value: "between", confidence: 80 }],
		["rate", "The slowest direction sets the pace. With the best step size, the error shrinks each step by about $1 - 1/\\kappa$, where $\\kappa = \\lambda_{\\max}/\\lambda_{\\min}$ is the condition number.",
			{ tool: "quiz", type: "check", nodeId: "rate", question: "If $\\kappa$ grows from 10 to 1000, roughly how many more steps does the same accuracy take?", options: [["About 100 times more", "100x"], ["About 10 times more", "10x"], ["The same", "same"]], correct: "100x", explanation: "Steps scale like $\\kappa$, and $\\kappa$ grew by a factor of 100." },
			{ value: "100x", confidence: 65 }],
		["smooth", "Real losses are not bowls, but an $L$-smooth loss has curvature at most $L$ everywhere: the gradient cannot change faster than $L$ times the distance moved. $L$ plays the role of $\\lambda_{\\max}$.",
			{ tool: "quiz", type: "check", nodeId: "smooth", question: "What does $L$-smoothness bound?", options: [["How fast the gradient can change", "grad-change"], ["How large the loss can be", "loss"], ["How large the gradient can be", "grad-size"]], correct: "grad-change", explanation: "$\\|\\nabla f(\\mathbf{x}) - \\nabla f(\\mathbf{y})\\| \\le L\\|\\mathbf{x}-\\mathbf{y}\\|$. It bounds the change, not the size." },
			{ value: "grad-size", confidence: 55, thinking: "Lipschitz means bounded slope" }],
		["beyond", "So the bowl result carries over: on an $L$-smooth convex loss, any $\\alpha < 2/L$ makes every step decrease the loss. The quadratic was the worst case all along.",
			{ tool: "quiz", type: "check", nodeId: "beyond", question: "A loss is $L$-smooth with $L = 50$. Which step size is guaranteed to decrease it every step?", options: [["$\\alpha = 0.03$", "0.03"], ["$\\alpha = 0.05$", "0.05"], ["$\\alpha = 0.5$", "0.5"]], correct: "0.03", explanation: "$2/L = 0.04$, and only $0.03$ is below it." },
			{ value: "0.03", confidence: 80 }],
	];
	for (const [, prose, q, a] of checks) {
		step(3);
		ask(m, prose, q, t, a);
	}

	step(3);
	const lastProse = [
		"Freeze the current parameters $\\mathbf{x}$. The loss is an average over $N$ training examples, so the full gradient is an average too:",
		"$$\\mathbf{g} = \\nabla f(\\mathbf{x}) = \\frac{1}{N}\\sum_{i=1}^{N} \\nabla \\ell_i(\\mathbf{x}).$$",
		"Pick one example $I$ uniformly at random and use its gradient alone, $\\hat{\\mathbf{g}} = \\nabla \\ell_I(\\mathbf{x})$. Every example has probability $1/N$, so",
		"$$\\mathbb{E}[\\hat{\\mathbf{g}}] = \\sum_{i=1}^{N} \\frac{1}{N}\\,\\nabla \\ell_i(\\mathbf{x}) = \\mathbf{g}.$$",
		"> **Unbiased** means the estimate is right on average. It does **not** mean any single estimate is accurate.",
		"A tiny example. Two examples have derivatives $-2$ and $6$ at the current point, so the full derivative is $2$. One sampled example returns $-2$ or $6$, never $2$, yet $\\mathbb{E}[\\hat g] = \\tfrac12(-2) + \\tfrac12(6) = 2$.",
		"The errors are $-4$ and $+4$. They cancel **on average**, and a single step can even point uphill. That is noise, not bias, and noise is something you can shrink.",
	].join("\n\n");
	ask(m, lastProse, {
		tool: "quiz", type: "predict", nodeId: "sgd",
		question: "Average the gradients of $B$ examples sampled independently. What happens to the spread of $\\hat{\\mathbf{g}}$ around $\\mathbf{g}$ as $B$ grows?",
		details: "A guess is fine. The next step works it out.",
		options: [
			["Nothing changes. Each example is as noisy as before.", "same"],
			["The variance shrinks like $1/B^2$, so doubling the batch halves the error.", "inv-b2"],
			["The variance shrinks like $1/B$, so the typical error shrinks like $1/\\sqrt{B}$.", "inv-b"],
			["The average drifts toward the examples with the largest gradients.", "biased"],
		],
		correct: "inv-b",
		explanation: "Independent errors add in variance: the sum of $B$ has variance $B\\sigma^2$, and dividing by $B$ gives $\\sigma^2/B$.",
	}, t);
	return { messages: m, end: t };
}

// ─── write everything ─────────────────────────────────────────────────────────

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "chats"), { recursive: true });
fs.mkdirSync(path.join(out, "graph"), { recursive: true });

const nodesOut: string[] = [], chainsOut: string[] = [], coverageOut: string[] = [];
const summary: string[] = [];

function turnsFor(messages: LhMessage[], last: boolean) {
	return messages.filter((x) => (x as { role: string }).role === "assistant").map((x, i, all) => {
		const final = last && i === all.length - 1;
		const ts = (x as { timestamp: number }).timestamp;
		const step = { inputTokens: final ? 2_400 : 1_200 + i * 90, outputTokens: 900 + (i % 4) * 260, cacheReadTokens: 22_000 + i * 4_600, cacheWriteTokens: 3_100, cacheWrite1hTokens: 0, reasoningTokens: 600 };
		// The context meter reads the message's own usage: keep it equal to the turn log.
		(x as { usage: unknown }).usage = {
			input: step.inputTokens, output: step.outputTokens, cacheRead: step.cacheReadTokens, cacheWrite: step.cacheWriteTokens,
			totalTokens: step.inputTokens + step.outputTokens + step.cacheReadTokens + step.cacheWriteTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		return { id: crypto.randomUUID(), messageId: x.id, at: iso(ts), model: TURN_MODEL, steps: [step] };
	});
}

function writeChat(id: string, title: string, created: number, messages: LhMessage[], extra: Record<string, unknown>) {
	const updated = (messages.at(-1) as { timestamp: number }).timestamp;
	const record = { id, title, createdAt: iso(created), updatedAt: iso(updated), version: 1, settings: { model: MODEL, thinkingLevel: "high" }, messages, ...extra };
	fs.writeFileSync(path.join(out, "chats", `${id}.json`), JSON.stringify(record, null, "\t"));
	for (const slot of coverageSlots(messages)) {
		if (slot.tokens > 0) coverageOut.push(JSON.stringify({ chatId: id, fp: slot.fp, tokens: slot.tokens, foldedAt: iso(updated + 60_000) }));
	}
}

function addTopic(slug: string, chat: string, messageIds: string[], created: number) {
	const topic = JSON.parse(fs.readFileSync(path.join(here, "topics", `${slug}.json`), "utf-8")) as Topic;
	const ids = new Map<string, string>();
	topic.nodes.forEach((n, i) => {
		const id = `n_${hex(6)}`;
		ids.set(n.key, id);
		const messageId = messageIds[Math.min(messageIds.length - 1, Math.floor((i / topic.nodes.length) * messageIds.length))];
		nodesOut.push(JSON.stringify({ id, name: n.name, statement: n.statement, aliases: [], createdAt: iso(created), provenance: [{ chatId: chat, messageId }] }));
	});
	for (const c of topic.chains) {
		chainsOut.push(JSON.stringify({ id: `arg_${hex(6)}`, premises: c.premises.map((k) => ids.get(k)!), conclusion: ids.get(c.conclusion)!, createdAt: iso(created), provenance: [{ chatId: chat, messageId: "" }] }));
	}
	summary.push(`${slug}: ${topic.nodes.length} nodes, ${topic.chains.length} chains`);
}

// The hero, last active a minute ago.
{
	const start = NOW - 42 * MIN;
	const { messages } = heroMessages(start);
	const lastAt = NOW - 1 * MIN;
	(messages.at(-1) as { timestamp: number }).timestamp = lastAt;
	const id = chatId(start);
	writeChat(id, "Gradient descent", start, messages, { tree: PLAN, turns: turnsFor(messages, true) });
	const teacherIds = messages.filter((x) => (x as { role: string }).role === "assistant").map((x) => x.id);
	addTopic("gradient-descent", id, teacherIds, lastAt);
}

for (const s of SESSIONS) {
	const start = NOW - s.ago - 35 * MIN;
	const end = NOW - s.ago;
	const u = user(s.ask, start);
	const a = assistant([{ type: "text", text: s.reply }], end, "stop");
	const id = chatId(start);
	writeChat(id, s.title, start, [u, a], {
		...(s.kind ? { kind: s.kind } : {}),
		...(s.settledAgo ? { settledAt: iso(NOW - s.settledAgo) } : {}),
		turns: turnsFor([a], false),
	});
	if (s.slug) addTopic(s.slug, id, [a.id], end);
}

fs.writeFileSync(path.join(out, "graph", "format.json"), JSON.stringify({ version: 1 }, null, "\t") + "\n");
fs.writeFileSync(path.join(out, "graph", "nodes.jsonl"), nodesOut.join("\n") + "\n");
fs.writeFileSync(path.join(out, "graph", "chains.jsonl"), chainsOut.join("\n") + "\n");
fs.writeFileSync(path.join(out, "graph", "coverage.jsonl"), coverageOut.join("\n") + "\n");
fs.writeFileSync(path.join(out, "settings.json"), JSON.stringify({
	version: 1,
	models: {
		strong: { model: MODEL, thinkingLevel: "high" },
		cheap: { model: { provider: "anthropic", id: "claude-sonnet-5-5" }, thinkingLevel: "medium" },
		vision: { model: { provider: "anthropic", id: "claude-sonnet-5-5" }, thinkingLevel: "medium" },
	},
}, null, "\t") + "\n");
fs.writeFileSync(path.join(out, "auth.json"), JSON.stringify({ ANTHROPIC_API_KEY: `sk-ant-api03-${"x".repeat(93)}` }, null, "\t") + "\n", { mode: 0o600 });

console.log(summary.join("\n"));
console.log(`${nodesOut.length} nodes, ${chainsOut.length} chains, ${SESSIONS.length + 1} sessions → ${out}`);
