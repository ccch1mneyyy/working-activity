import assert from "node:assert/strict";
import test from "node:test";

import { initTheme } from "@earendil-works/pi-coding-agent";
import workingActivity, { __testing } from "../extensions/index.ts";

initTheme("dark");

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

function createContext() {
	const statuses: Array<{ key: string; value: string | undefined }> = [];
	const messages: Array<string | undefined> = [];
	const indicators: unknown[] = [];
	const notifications: string[] = [];
	const theme = {
		fg: (_color: string, text: string) => `\x1b[38;2;80;160;220m${text}\x1b[0m`,
		bold: (text: string) => text,
	};
	return {
		ctx: {
			mode: "tui",
			ui: {
				theme,
				setStatus: (key: string, value: string | undefined) => statuses.push({ key, value }),
				setWorkingMessage: (value?: string) => messages.push(value),
				setWorkingIndicator: (value?: unknown) => indicators.push(value),
				notify: (value: string) => notifications.push(value),
				custom: async (factory: any) => new Promise((resolve) => {
					const done = (value: unknown) => resolve(value);
					const component = factory({ requestRender() {} }, theme, {}, done);
					component.render(100);
					done(undefined);
				}),
			},
			getContextUsage: () => ({ tokens: 12000, percent: 15 }),
		},
		statuses,
		messages,
		indicators,
		notifications,
	};
}

function createPiHarness() {
	const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => unknown }>();
	const pi = {
		on(name: string, handler: (event: any, ctx: any) => unknown) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		registerCommand(name: string, command: { handler: (args: string, ctx: any) => unknown }) {
			commands.set(name, command);
		},
	};
	workingActivity(pi as any);
	return {
		async emit(name: string, event: any, ctx: any) {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		},
		async command(name: string, args: string, ctx: any) {
			const command = commands.get(name);
			assert.ok(command, `command ${name} should be registered`);
			await command.handler(args, ctx);
		},
	};
}

test("shimmer preserves emoji graphemes in UTF-8", () => {
	const { ctx } = createContext();
	const source = "🎄春节 👩‍💻";
	const styled = __testing.shimmer(source, 3, "50a0dc", ctx as any);
	assert.equal(stripAnsi(styled), source);
	assert.equal(Buffer.from(styled, "utf8").toString("utf8").includes("�"), false);
	assert.deepEqual(__testing.splitGraphemes("👩‍💻A"), ["👩‍💻", "A"]);
});

test("tool progress extracts structured, percentage, and stage updates", () => {
	assert.equal(__testing.extractToolProgress({ details: { percent: 0.42 } }), "42%");
	assert.equal(__testing.extractToolProgress({ details: { progress: { current: 3, total: 4 } } }), "75%");
	assert.equal(__testing.extractToolProgress({ content: [{ type: "text", text: "download 63.2%" }] }), "63%");
	assert.equal(__testing.extractToolProgress({ content: [{ type: "text", text: "下载 模型分片" }] }), "下载 模型分片");
	assert.equal(__testing.extractToolProgress({ content: [{ type: "text", text: "ordinary output" }] }), null);
});

test("narrate extracts only the latest concatenated status marker", () => {
	assert.equal(
		__testing.extractLatestNarratedStatus("⏵ 读取方案与仓库现状⏵ 并行核验关键假设⏵ 核对文档执行规范"),
		"核对文档执行规范",
	);
	assert.equal(
		__testing.extractLatestNarratedStatus("前文\n⏵ 读完剩余测试再动手\n正文\n⏵ 确认两处测试依赖细节"),
		"确认两处测试依赖细节",
	);
	assert.equal(__testing.extractLatestNarratedStatus("没有状态标记"), null);
});

test("danger threshold never remains below warning threshold", () => {
	assert.deepEqual(
		__testing.normalizeThresholds({ frames: "moon", contextWarnAt: 96, contextDangerAt: 90 }),
		{ frames: "moon", contextWarnAt: 96, contextDangerAt: 96 },
	);
	assert.deepEqual(
		__testing.normalizeThresholds({ frames: "moon", contextWarnAt: 0, contextDangerAt: 90 }),
		{ frames: "moon", contextWarnAt: 0, contextDangerAt: 90 },
	);
});

test("settings panel constructs and doctor completes its persistence probe", async () => {
	const harness = createPiHarness();
	const state = createContext();
	await harness.command("activity", "settings", state.ctx as any);
	await harness.command("activity", "doctor", state.ctx as any);
	assert.equal(state.notifications.some((message) => message.startsWith("Activity Doctor\n")), true);
});

test("completion waits for agent_settled and preserves retry tool totals", async () => {
	const harness = createPiHarness();
	const state = createContext();
	const ctx = state.ctx as any;
	const beforeEvent = { systemPrompt: "base", systemPromptOptions: {}, prompt: "test" };

	await harness.emit("before_agent_start", beforeEvent, ctx);
	await harness.emit("agent_start", {}, ctx);
	await harness.emit("tool_execution_start", { toolCallId: "a", toolName: "read", args: { path: "a.ts" } }, ctx);
	await harness.emit("tool_execution_end", { toolCallId: "a", toolName: "read", isError: false }, ctx);
	await harness.emit("agent_end", { messages: [{ role: "assistant", stopReason: "error" }] }, ctx);

	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.equal(state.statuses.some(({ value }) => value && stripAnsi(value).includes("✓")), false);

	await harness.emit("agent_start", {}, ctx);
	await harness.emit("tool_execution_start", { toolCallId: "b", toolName: "bash", args: { command: "npm test" } }, ctx);
	await harness.emit("tool_execution_end", { toolCallId: "b", toolName: "bash", isError: false }, ctx);
	await harness.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	await harness.emit("agent_settled", {}, ctx);

	await new Promise((resolve) => setTimeout(resolve, 90));
	const completion = [...state.statuses].reverse().find(({ value }) => value)?.value ?? "";
	assert.match(stripAnsi(completion), /✓/);
	assert.match(stripAnsi(completion), /2 工具/);

	await harness.emit("session_shutdown", {}, ctx);
	assert.equal(state.indicators.at(-1), undefined);
	assert.equal(state.messages.at(-1), undefined);
});

test("fmtCost formats cost at appropriate precision", () => {
	assert.equal(__testing.fmtCost(0), "$0");
	assert.equal(__testing.fmtCost(0.00001), "$0.00001");
	assert.equal(__testing.fmtCost(0.005), "$0.0050");
	assert.equal(__testing.fmtCost(0.042), "$0.042");
	assert.equal(__testing.fmtCost(0.087), "$0.087");
	assert.equal(__testing.fmtCost(1.5), "$1.50");
	assert.equal(__testing.fmtCost(42), "$42.00");
});

test("fmtTokens formats token counts compactly", () => {
	assert.equal(__testing.fmtTokens(0), "0");
	assert.equal(__testing.fmtTokens(42), "42");
	assert.equal(__testing.fmtTokens(1000), "1.0k");
	assert.equal(__testing.fmtTokens(12300), "12.3k");
	assert.equal(__testing.fmtTokens(2000000), "2.0M");
});

test("cost accumulates with dedup and shows in settled notify", async () => {
	const harness = createPiHarness();
	const state = createContext();
	const ctx = state.ctx as any;

	await harness.emit("before_agent_start", { systemPrompt: "", systemPromptOptions: {}, prompt: "cost test" }, ctx);
	await harness.emit("agent_start", {}, ctx);

	// 两条不同 timestamp 的 assistant message_end，都有 usage
	await harness.emit("message_end", {
		message: {
			role: "assistant",
			timestamp: 1000,
			usage: { input: 5000, output: 2000, cacheRead: 3000, cacheWrite: 1000, reasoning: 500, totalTokens: 11000, cost: { input: 0.015, output: 0.01, cacheRead: 0.001, cacheWrite: 0.005, total: 0.031 } },
		},
	}, ctx);
	// 同一 timestamp 重发 → 应被去重
	await harness.emit("message_end", {
		message: {
			role: "assistant",
			timestamp: 1000,
			usage: { input: 5000, output: 2000, cacheRead: 3000, cacheWrite: 1000, reasoning: 500, totalTokens: 11000, cost: { input: 0.015, output: 0.01, cacheRead: 0.001, cacheWrite: 0.005, total: 0.031 } },
		},
	}, ctx);
	// 第二条新 timestamp
	await harness.emit("message_end", {
		message: {
			role: "assistant",
			timestamp: 2000,
			usage: { input: 8000, output: 1000, cacheRead: 5000, cacheWrite: 0, totalTokens: 14000, cost: { total: 0.029 } },
		},
	}, ctx);

	await harness.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
	await harness.emit("agent_settled", {}, ctx);

	// notify 有 secs>=3 门槛；用 /activity stats 验证累加结果（去重后 0.031 + 0.029 = 0.06）
	await harness.command("activity", "stats", ctx);
	const statsNotify = state.notifications.find((n) => n.includes("💰"));
	assert.ok(statsNotify, "stats should include cost info");
	assert.match(statsNotify, /\$0\.06/);
	assert.match(statsNotify, /25\.0k/);
});

test("session_compact flashes compaction notice with token savings", async () => {
	const harness = createPiHarness();
	const state = createContext();
	const ctx = state.ctx as any;

	await harness.emit("before_agent_start", { systemPrompt: "", systemPromptOptions: {}, prompt: "test" }, ctx);
	await harness.emit("agent_start", {}, ctx);

	await harness.emit("session_compact", {
		type: "session_compact",
		compactionEntry: {
			tokensBefore: 45000,
			summary: "summary",
			usage: { cost: { total: 0.015 } },
		},
		reason: "threshold",
		willRetry: false,
		fromExtension: false,
	}, ctx);

	await new Promise((resolve) => setTimeout(resolve, 120));
	// flashStatus 用 DONE_STATUS_KEY；闪现内容应包含压缩信息
	const flash = state.statuses.find((s) => s.key === "working-activity-done" && s.value);
	assert.ok(flash, "should flash a compaction status");
	const text = stripAnsi(flash!.value!);
	assert.match(text, /45\.0k/);
	assert.match(text, /12\.0k/);
	// contextWarnPct 应被重置
	assert.equal(state.notifications.some((n) => n.includes("上下文")), false);

	await harness.emit("session_shutdown", {}, ctx);
});
