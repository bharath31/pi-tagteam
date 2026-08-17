import { describe, expect, it } from "vitest";
import {
	detectCodexInterruptions,
	extractCodexSessionId,
	parseCodexJsonLine,
} from "../src/codex.js";

describe("Codex Parser", () => {
	it("extracts session ID from filename", () => {
		const filename = "rollout-2026-07-03T19-56-20-019f285f-956e-73e3-9fb9-5acdacb6aa6b.jsonl";
		expect(extractCodexSessionId(filename)).toBe("019f285f-956e-73e3-9fb9-5acdacb6aa6b");
	});

	it("parses turn_context cwd", () => {
		const line = JSON.stringify({
			type: "turn_context",
			timestamp: "2026-07-03T14:26:23.975Z",
			payload: {
				cwd: "/Users/bharath/dev/project",
				model: "gpt-5.5",
			},
		});

		const parsed = parseCodexJsonLine(line);
		expect(parsed).toBeDefined();
		expect(parsed?.type).toBe("turn_context");
		expect(parsed?.cwd).toBe("/Users/bharath/dev/project");
	});

	it("parses user_message event", () => {
		const line = JSON.stringify({
			type: "event_msg",
			timestamp: "2026-07-03T14:26:23.980Z",
			payload: {
				type: "user_message",
				message: "Install the Auth0 plugin and test connectivity",
			},
		});

		const parsed = parseCodexJsonLine(line);
		expect(parsed).toBeDefined();
		expect(parsed?.role).toBe("user");
		expect(parsed?.text).toBe("Install the Auth0 plugin and test connectivity");
	});

	it("parses token_count and rate limits", () => {
		const line = JSON.stringify({
			type: "event_msg",
			payload: {
				type: "token_count",
				info: {
					total_token_usage: {
						input_tokens: 15000,
						output_tokens: 400,
						total_tokens: 15400,
					},
				},
				rate_limits: {
					primary: {
						used_percent: 98,
						resets_at: 1785680787,
					},
					rate_limit_reached_type: "credits",
				},
			},
		});

		const parsed = parseCodexJsonLine(line);
		expect(parsed).toBeDefined();
		expect(parsed?.tokenUsage?.total).toBe(15400);
		expect(parsed?.rateLimits?.usedPercent).toBe(98);
		expect(parsed?.rateLimits?.type).toBe("credits");
	});

	it("parses custom_tool_call", () => {
		const line = JSON.stringify({
			type: "response_item",
			payload: {
				type: "custom_tool_call",
				name: "exec",
				input: "const res = await fetch('http://localhost:3000');",
			},
		});

		const parsed = parseCodexJsonLine(line);
		expect(parsed).toBeDefined();
		expect(parsed?.role).toBe("assistant");
		expect(parsed?.toolCall?.name).toBe("exec");
		expect(parsed?.toolCall?.argsSummary).toContain("const res = await fetch");
	});

	it("detects codex limit markers", () => {
		const hits = detectCodexInterruptions([
			"All systems operational",
			"Warning: rate_limit_reached for organization",
		]);
		expect(hits.length).toBeGreaterThan(0);
	});
});
