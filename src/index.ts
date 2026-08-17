/**
 * pi-tagteam: Seamless handoff from Claude Code and OpenAI Codex to Pi.
 *
 * When another coding agent hits rate limits, context window exhaustion,
 * crashes, or stops mid-task, pi-tagteam ingests its full session state,
 * in-flight subagents, and uncommitted worktree changes, passing the baton
 * directly to Pi to continue without missing a beat.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatRelativeTime } from "./brief.js";
import { registerHandoffCommands } from "./commands.js";
import { discoverSessions } from "./discovery.js";
import { registerHandoffTool } from "./tool.js";

export default function (pi: ExtensionAPI) {
	// 1. Register LLM tools
	registerHandoffTool(pi);

	// 2. Register slash commands (/tagteam, /handoff, /relay, /claude, /codex)
	registerHandoffCommands(pi);

	// 3. Check for recent interrupted sessions on startup (non-intrusive notification)
	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "startup" || !ctx.hasUI) return;

		try {
			// Scan for sessions updated within the last 2 hours in this directory
			const recent = await discoverSessions({
				cwd: ctx.cwd,
				tool: "both",
				maxAgeHours: 2,
				maxResults: 1,
			});

			if (recent.length > 0) {
				const s = recent[0];
				const toolName = s.tool === "claude" ? "Claude Code" : "OpenAI Codex";
				const timeStr = formatRelativeTime(s.mtime);
				const titleStr = s.title ? `: "${s.title.slice(0, 40)}"` : "";

				ctx.ui.notify(
					`💡 Recent ${toolName} session detected (${timeStr}${titleStr}). Run /tagteam to take over.`,
					"info",
				);
			}
		} catch {
			/* ignore discovery errors on startup */
		}
	});
}
