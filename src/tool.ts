/**
 * Pi LLM Tool: tagteam_handoff (and session_handoff alias)
 */

import { basename } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { createHandoffBrief, formatRelativeTime } from "./brief.js";
import { discoverSessions } from "./discovery.js";
import type { AgentToolType } from "./types.js";

const toolSchema = Type.Object({
	tool: Type.Optional(
		StringEnum(["claude", "codex", "both"] as const, {
			description: "Which agent session store to scan: 'claude', 'codex', or 'both' (default: 'both')",
		}),
	),
	maxAgeHours: Type.Optional(
		Type.Number({
			description: "Only scan sessions updated within this many hours (default: 48)",
		}),
	),
	sessionId: Type.Optional(
		Type.String({
			description: "Optional specific session ID, UUID, or filename to target",
		}),
	),
	allProjects: Type.Optional(
		Type.Boolean({
			description: "Scan sessions across all projects on the system instead of only current workspace (default: false)",
		}),
	),
	format: Type.Optional(
		StringEnum(["brief", "full", "summary"] as const, {
			description: "Output format: 'brief' (default prompt), 'full' (detailed breakdown), or 'summary' (concise metadata)",
		}),
	),
});

export type TagteamToolInput = Static<typeof toolSchema>;

export interface TagteamToolDetails {
	count: number;
	pickedSession?: string;
	tool?: AgentToolType;
	uncommittedFiles?: number;
	subagentsCount?: number;
	availableSessions?: Array<{
		id: string;
		tool: AgentToolType;
		title?: string;
		mtime: number;
		relativeTime: string;
	}>;
}

export function registerHandoffTool(pi: ExtensionAPI): void {
	const toolHandler = async (
		_toolCallId: string,
		params: TagteamToolInput,
		_signal: AbortSignal | undefined,
		_onUpdate: unknown,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<TagteamToolDetails>> => {
		const tool = params.tool ?? "both";
		const maxAgeHours = typeof params.maxAgeHours === "number" && params.maxAgeHours > 0 ? params.maxAgeHours : 48;
		const allProjects = Boolean(params.allProjects);
		const sessionId = params.sessionId;
		const format = params.format ?? "brief";

		const sessions = await discoverSessions({
			cwd: ctx.cwd,
			tool,
			maxAgeHours,
			allProjects,
			sessionId,
			maxResults: 10,
		});

		if (sessions.length === 0) {
			return {
				content: [
					{
						type: "text" as const,
						text: `No ${tool === "both" ? "Claude Code or Codex" : tool} sessions found ${
							allProjects ? "across the system" : `for project ${ctx.cwd}`
						} in the last ${maxAgeHours} hours. Try increasing maxAgeHours or passing allProjects: true.`,
					},
				],
				details: { count: 0 },
			};
		}

		// Pick the most recent session or the exact match
		const pickedSource = sessions[0];
		const brief = await createHandoffBrief(pickedSource, ctx.cwd);

		let outputText = "";
		if (format === "brief") {
			outputText = brief.resumePrompt;
		} else if (format === "full") {
			outputText = brief.markdownSummary + "\n\n" + brief.resumePrompt;
		} else {
			outputText =
				`Found ${sessions.length} sessions. Most recent: [${pickedSource.tool}] ${basename(pickedSource.file)} ` +
				`(${formatRelativeTime(pickedSource.mtime)}): "${pickedSource.title || "Untitled"}"\n` +
				`Uncommitted files: ${brief.stats.uncommittedFiles}, Subagents: ${brief.stats.subagentsCount}\n` +
				`Interruption: ${brief.session.interruptionMarkers.join(", ") || "none"}`;
		}

		return {
			content: [{ type: "text" as const, text: outputText }],
			details: {
				count: sessions.length,
				pickedSession: pickedSource.id,
				tool: pickedSource.tool,
				uncommittedFiles: brief.stats.uncommittedFiles,
				subagentsCount: brief.stats.subagentsCount,
				availableSessions: sessions.map((s) => ({
					id: s.id,
					tool: s.tool,
					title: s.title,
					mtime: s.mtime,
					relativeTime: formatRelativeTime(s.mtime),
				})),
			},
		};
	};

	// Primary tool
	pi.registerTool({
		name: "tagteam_handoff",
		label: "TagTeam Handoff",
		description:
			"Find and hand off context from recent Claude Code or OpenAI Codex sessions. " +
			"Extracts the interrupted task, last assistant thoughts, in-flight subagents, and uncommitted git changes. " +
			"Use when continuing work started in Claude Code or Codex, or after another agent hit rate limits or stopped.",
		promptSnippet: "Hand off session context and uncommitted work from Claude Code or Codex",
		promptGuidelines: [
			"Use tagteam_handoff when the user asks to continue, resume, or take over work previously done in Claude Code or Codex.",
		],
		parameters: toolSchema,
		execute: toolHandler,
	});

	// Register session_handoff alias only if not already registered by another extension
	try {
		const existingTools = pi.getAllTools();
		if (!existingTools.some((t) => t.name === "session_handoff")) {
			pi.registerTool({
				name: "session_handoff",
				label: "Session Handoff",
				description:
					"Find the most recent Claude Code or Codex session in the current project and produce a handoff brief. " +
					"Use this when asked to continue work started by another coding agent.",
				promptSnippet: "Find and resume interrupted Claude Code / Codex sessions",
				parameters: toolSchema,
				execute: toolHandler,
			});
		}
	} catch {
		/* tool list unavailable or already registered */
	}
}
