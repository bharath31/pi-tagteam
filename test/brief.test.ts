import { describe, expect, it } from "vitest";
import { formatRelativeTime, generateMarkdownSummary, generateResumePrompt } from "../src/brief.js";
import type { ParsedSession } from "../src/types.js";

describe("Brief and Resume Prompt Synthesizer", () => {
	it("formats relative times correctly", () => {
		const now = Date.now();
		expect(formatRelativeTime(now - 30_000)).toBe("30s ago");
		expect(formatRelativeTime(now - 5 * 60_000)).toBe("5m ago");
		expect(formatRelativeTime(now - 3 * 3600_000)).toBe("3h ago");
		expect(formatRelativeTime(now - 2 * 86400_000)).toBe("2d ago");
	});

	it("generates structured resume prompt with all sections", () => {
		const mockSession: ParsedSession = {
			source: {
				id: "abc-123",
				tool: "claude",
				file: "/home/user/.claude/projects/test/abc-123.jsonl",
				cwd: "/home/user/project",
				mtime: Date.now() - 600_000,
				size: 4096,
				gitBranch: "feature/login",
			},
			initialPrompt: "Implement passkey authentication using WebAuthn",
			lastUserPrompt: "Please also add unit tests for passkey verification",
			lastAssistantText: "I've started creating the verification handler in `src/passkey.ts`...",
			recentTurns: [],
			toolUsageSummary: { read: 5, edit: 3, bash: 2 },
			interruptionMarkers: ["Hit session limit (resets 2:00 PM)"],
			subagents: [
				{
					id: "sub-1",
					agentType: "Explore",
					status: "completed",
					description: "Search for WebAuthn utils",
				},
				{
					id: "sub-2",
					agentType: "Plan",
					status: "interrupted",
					description: "Design test matrix",
					worktreePath: "/home/user/project/.claude/worktrees/sub-2",
				},
			],
			tasks: [
				{ subject: "Create passkey handler", status: "completed" },
				{ subject: "Add verification unit tests", status: "in_progress" },
			],
			uncommittedWork: [
				{
					worktree: "/home/user/project",
					branch: "feature/login",
					isIsolatedWorktree: false,
					statusLines: ["M src/passkey.ts", "?? test/passkey.test.ts"],
					statSummary: "2 files changed, 45 insertions(+)",
					modifiedFiles: ["src/passkey.ts"],
					untrackedFiles: ["test/passkey.test.ts"],
				},
			],
		};

		const prompt = generateResumePrompt(mockSession);
		expect(prompt).toContain("Tag-Team Handoff from Claude Code");
		expect(prompt).toContain("Hit session limit");
		expect(prompt).toContain("Original Task / Goal");
		expect(prompt).toContain("Implement passkey authentication");
		expect(prompt).toContain("Where the Previous Agent Stopped");
		expect(prompt).toContain("In-Flight Subagents");
		expect(prompt).toContain("sub-2");
		expect(prompt).toContain("Uncommitted Work");
		expect(prompt).toContain("M src/passkey.ts");
		expect(prompt).toContain("read: 5 · edit: 3 · bash: 2");
		expect(prompt).toContain("Instructions for Pi");

		const markdown = generateMarkdownSummary(mockSession);
		expect(markdown).toContain("Handoff Brief: Claude Code");
		expect(markdown).toContain("abc-123");
	});
});
