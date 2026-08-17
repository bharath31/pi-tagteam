/**
 * Handoff Brief generator and Resume Prompt synthesizer
 */

import { basename } from "node:path";
import { parseClaudeSession } from "./claude.js";
import { parseCodexSession } from "./codex.js";
import { collectAllUncommittedWork } from "./git.js";
import type {
	HandoffBrief,
	ParsedSession,
	SessionSource,
	UncommittedWork,
} from "./types.js";

/**
 * Build a complete parsed session from a SessionSource
 */
export async function buildParsedSession(
	source: SessionSource,
	targetCwd: string,
): Promise<ParsedSession> {
	let parsed: ParsedSession;

	if (source.tool === "claude") {
		parsed = await parseClaudeSession(source);
	} else {
		parsed = await parseCodexSession(source);
	}

	// Gather all uncommitted work (main repo + any subagent worktrees discovered)
	const subagentWorktrees = parsed.subagents
		.map((s) => s.worktreePath)
		.filter((p): p is string => Boolean(p));

	const uncommitted = await collectAllUncommittedWork(targetCwd, subagentWorktrees);
	parsed.uncommittedWork = uncommitted;

	return parsed;
}

/**
 * Format relative time string (e.g. "15m ago", "2h ago")
 */
export function formatRelativeTime(timestamp: number): string {
	const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (diffSec < 60) return `${diffSec}s ago`;
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHours = Math.floor(diffMin / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays}d ago`;
}

/**
 * Build the LLM prompt to kick off the continuation in Pi
 */
export function generateResumePrompt(session: ParsedSession): string {
	const toolLabel = session.source.tool === "claude" ? "Claude Code" : "OpenAI Codex";
	const sessionId = basename(session.source.file, ".jsonl");
	const parts: string[] = [];

	parts.push(`## 🤝 Tag-Team Handoff from ${toolLabel}`);
	parts.push(`- **Previous Agent**: ${toolLabel} (Session \`${sessionId}\`)`);
	if (session.source.gitBranch) {
		parts.push(`- **Branch**: \`${session.source.gitBranch}\``);
	}
	if (session.source.cwd) {
		parts.push(`- **Workspace**: \`${session.source.cwd}\``);
	}
	if (session.interruptionMarkers.length > 0) {
		parts.push(`- **⚠️ Interruption / Limit**: ${session.interruptionMarkers.join("; ")}`);
	}

	parts.push("");

	// 1. Initial User Request / Goal
	if (session.initialPrompt || session.lastUserPrompt) {
		parts.push("### 🎯 Original Task / Goal");
		const goalText = session.initialPrompt || session.lastUserPrompt || "";
		parts.push(goalText.length > 3000 ? goalText.slice(0, 3000) + "\n…(truncated)" : goalText);
		parts.push("");
	}

	// 2. Where It Stopped
	if (session.lastAssistantText) {
		parts.push("### 🛑 Where the Previous Agent Stopped");
		const stopText = session.lastAssistantText;
		parts.push(stopText.length > 3000 ? stopText.slice(0, 3000) + "\n…(truncated)" : stopText);
		parts.push("");
	}

	// 3. Tasks in Progress
	if (session.tasks.length > 0) {
		parts.push("### 📋 Stored Tasks / Checkpoints");
		for (const t of session.tasks) {
			const icon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "⏳" : "⚪";
			parts.push(`- ${icon} [${t.status}] ${t.subject}`);
		}
		parts.push("");
	}

	// 4. Subagents in Flight
	if (session.subagents.length > 0) {
		parts.push("### 🤖 In-Flight Subagents");
		for (const s of session.subagents) {
			const icon = s.status === "completed" ? "✅" : s.status === "interrupted" ? "⚠️" : "⏳";
			let line = `- ${icon} **${s.id}** (${s.agentType}, status: ${s.status})`;
			if (s.description) line += `: ${s.description}`;
			if (s.worktreePath) line += ` → worktree: \`${s.worktreePath}\``;
			parts.push(line);
		}
		parts.push("");
	}

	// 5. Uncommitted Work / Worktrees
	if (session.uncommittedWork.length > 0) {
		parts.push("### 💾 Uncommitted Work (Needs Salvage / Review)");
		for (const w of session.uncommittedWork) {
			const label = w.isIsolatedWorktree ? `Worktree: ${w.worktree}` : `Main Working Tree: ${w.worktree}`;
			parts.push(`**${label}**`);
			if (w.branch) parts.push(`*(Branch: ${w.branch})*`);
			if (w.statSummary) parts.push(`*(Diff Stat: ${w.statSummary})*`);
			parts.push("```");
			parts.push(...w.statusLines.slice(0, 30));
			if (w.statusLines.length > 30) {
				parts.push(`... and ${w.statusLines.length - 30} more modified files`);
			}
			parts.push("```");
		}
		parts.push("");
	}

	// 6. Tool Usage Stats
	const toolEntries = Object.entries(session.toolUsageSummary);
	if (toolEntries.length > 0) {
		parts.push("### ⚙️ Previous Tool Activity");
		const statsStr = toolEntries.map(([t, count]) => `${t}: ${count}`).join(" · ");
		parts.push(statsStr);
		parts.push("");
	}

	// 7. Instructions for Pi
	parts.push("### 🚀 Instructions for Pi");
	parts.push(
		"1. Examine the current workspace state and any uncommitted changes listed above.\n" +
			"2. Pick up from where the previous agent stopped and drive the task to completion.\n" +
			"3. If there are unfinished tasks or subagent worktrees, salvage their progress.\n" +
			"4. Run appropriate tests and verify that the solution is solid.",
	);

	return parts.join("\n");
}

/**
 * Generate human-readable Markdown summary for TUI widgets / preview
 */
export function generateMarkdownSummary(session: ParsedSession): string {
	const toolLabel = session.source.tool === "claude" ? "Claude Code" : "OpenAI Codex";
	const sessionId = basename(session.source.file, ".jsonl");
	const out: string[] = [];

	out.push(`# 🤝 Handoff Brief: ${toolLabel}`);
	out.push("");
	out.push(`- **Session ID**: \`${sessionId}\``);
	if (session.source.title) out.push(`- **Title**: ${session.source.title}`);
	if (session.source.cwd) out.push(`- **Workspace**: \`${session.source.cwd}\``);
	if (session.source.gitBranch) out.push(`- **Branch**: \`${session.source.gitBranch}\``);
	out.push(`- **Updated**: ${new Date(session.source.mtime).toLocaleString()} (${formatRelativeTime(session.source.mtime)})`);

	if (session.interruptionMarkers.length > 0) {
		out.push(`- **⚠️ Interrupted**: ${session.interruptionMarkers.join(", ")}`);
	}

	out.push("");

	if (session.initialPrompt) {
		out.push("## Original Request");
		out.push("```");
		out.push(session.initialPrompt.slice(0, 1500));
		out.push("```");
	}

	if (session.lastAssistantText) {
		out.push("## Last Assistant Output");
		out.push("```");
		out.push(session.lastAssistantText.slice(0, 1500));
		out.push("```");
	}

	if (session.tasks.length > 0) {
		out.push("## Tasks");
		for (const t of session.tasks) {
			out.push(`- [${t.status}] ${t.subject}`);
		}
	}

	if (session.subagents.length > 0) {
		out.push("## Subagents in Flight");
		for (const s of session.subagents) {
			out.push(`- **${s.id}** (${s.agentType}, ${s.status}): ${s.description || "No description"}`);
		}
	}

	if (session.uncommittedWork.length > 0) {
		out.push("## Uncommitted Changes");
		for (const w of session.uncommittedWork) {
			out.push(`### ${w.worktree}`);
			out.push("```");
			out.push(...w.statusLines.slice(0, 20));
			out.push("```");
		}
	}

	return out.join("\n");
}

/**
 * Construct full HandoffBrief
 */
export async function createHandoffBrief(
	source: SessionSource,
	targetCwd: string,
): Promise<HandoffBrief> {
	const session = await buildParsedSession(source, targetCwd);
	const resumePrompt = generateResumePrompt(session);
	const markdownSummary = generateMarkdownSummary(session);

	let uncommittedFiles = 0;
	for (const u of session.uncommittedWork) {
		uncommittedFiles += u.modifiedFiles.length + u.untrackedFiles.length;
	}

	let toolsUsed = 0;
	for (const count of Object.values(session.toolUsageSummary)) {
		toolsUsed += count;
	}

	return {
		session,
		resumePrompt,
		markdownSummary,
		stats: {
			toolsUsed,
			uncommittedFiles,
			subagentsCount: session.subagents.length,
			tasksCount: session.tasks.length,
			recentTurnsCount: session.recentTurns.length,
		},
	};
}
