import { describe, expect, it } from "vitest";
import {
	detectClaudeInterruptions,
	encodeClaudeProjectDir,
	encodeClaudeProjectDirSimple,
	parseClaudeJsonLine,
} from "../src/claude.js";

describe("Claude Code Parser", () => {
	it("encodes project directories correctly", () => {
		expect(encodeClaudeProjectDir("/Users/bharath/dev/agent-404")).toBe("-Users-bharath-dev-agent-404");
		expect(encodeClaudeProjectDir("/home/user/project.foo_bar")).toBe("-home-user-project-foo-bar");
		expect(encodeClaudeProjectDirSimple("/Users/bharath/dev/agent-404")).toBe("-Users-bharath-dev-agent-404");
	});

	it("parses user prompt line", () => {
		const line = JSON.stringify({
			type: "user",
			sessionId: "test-session-123",
			message: {
				role: "user",
				content: "Please refactor the auth handler to use OAuth2 PKCE",
			},
			gitBranch: "feature/auth",
			cwd: "/Users/bharath/dev/project",
		});

		const parsed = parseClaudeJsonLine(line);
		expect(parsed).toBeDefined();
		expect(parsed?.role).toBe("user");
		expect(parsed?.texts).toContain("Please refactor the auth handler to use OAuth2 PKCE");
		expect(parsed?.gitBranch).toBe("feature/auth");
		expect(parsed?.cwd).toBe("/Users/bharath/dev/project");
	});

	it("parses assistant message with tools and results", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "I will check the existing auth files first." },
					{ type: "tool_use", name: "read", input: { path: "src/auth.ts" } },
					{ type: "tool_result", content: "export function auth() {}" },
				],
			},
		});

		const parsed = parseClaudeJsonLine(line);
		expect(parsed).toBeDefined();
		expect(parsed?.role).toBe("assistant");
		expect(parsed?.texts).toContain("I will check the existing auth files first.");
		expect(parsed?.toolCalls).toHaveLength(1);
		expect(parsed?.toolCalls[0].name).toBe("read");
		expect(parsed?.toolCalls[0].argsSummary).toBe("src/auth.ts");
		expect(parsed?.toolResults).toHaveLength(1);
	});

	it("parses aiTitle entries", () => {
		const line = JSON.stringify({
			type: "ai-title",
			aiTitle: "Refactor auth handler with PKCE flow",
			sessionId: "abc-123",
		});

		const parsed = parseClaudeJsonLine(line);
		expect(parsed).toBeDefined();
		expect(parsed?.aiTitle).toBe("Refactor auth handler with PKCE flow");
	});

	it("detects interruption and limit markers", () => {
		const texts = [
			"Everything is running smoothly.",
			"Error: You have hit your usage limit. Resets at 1:40 PM Asia/Calcutta.",
		];

		const markers = detectClaudeInterruptions(texts);
		expect(markers.length).toBeGreaterThan(0);
		expect(markers.some((m) => m.includes("usage limit") || m.includes("Resets at"))).toBe(true);
	});
});
