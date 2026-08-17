/**
 * Slash commands for pi-tagteam (/tagteam, /handoff, /relay, /claude, /codex)
 */

import { basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createHandoffBrief, formatRelativeTime } from "./brief.js";
import { discoverSessions } from "./discovery.js";
import type { SessionSource } from "./types.js";

export function registerHandoffCommands(pi: ExtensionAPI): void {
	const handleCommand = async (
		args: string,
		ctx: ExtensionCommandContext,
		defaultTool: "claude" | "codex" | "both" = "both",
	) => {
		const rawArgs = args.trim().split(/\s+/).filter(Boolean);
		let tool: "claude" | "codex" | "both" = defaultTool;
		let maxAgeHours = 48;
		let allProjects = false;
		let autoLatest = false;
		let targetSessionId: string | undefined;

		for (const arg of rawArgs) {
			const lower = arg.toLowerCase();
			if (lower === "latest" || lower === "--latest" || lower === "-l") {
				autoLatest = true;
			} else if (lower === "all" || lower === "--all" || lower === "-a") {
				allProjects = true;
			} else if (lower === "claude") {
				tool = "claude";
			} else if (lower === "codex") {
				tool = "codex";
			} else if (/^\d+$/.test(arg)) {
				maxAgeHours = Number.parseInt(arg, 10);
			} else if (lower.startsWith("hours:")) {
				maxAgeHours = Number.parseInt(lower.slice(6), 10) || 48;
			} else {
				targetSessionId = arg;
			}
		}

		ctx.ui.notify(
			`Scanning for ${tool === "both" ? "Claude & Codex" : tool} sessions (${allProjects ? "global" : "this project"})...`,
			"info",
		);

		const sessions = await discoverSessions({
			cwd: ctx.cwd,
			tool,
			maxAgeHours,
			allProjects,
			sessionId: targetSessionId,
			maxResults: 15,
		});

		if (sessions.length === 0) {
			ctx.ui.notify(
				`No ${tool === "both" ? "Claude Code or Codex" : tool} sessions found within ${maxAgeHours}h. ` +
					"Try `/tagteam --all` to scan across all projects.",
				"info",
			);
			return;
		}

		let selectedSource: SessionSource;

		if (autoLatest || sessions.length === 1 || !ctx.hasUI) {
			selectedSource = sessions[0];
		} else {
			const labels = sessions.map((s) => {
				const toolBadge = s.tool === "claude" ? "[Claude]" : "[Codex]";
				const idStr = s.id.length > 8 ? s.id.slice(0, 8) : s.id;
				const relTime = formatRelativeTime(s.mtime);
				const title = s.title ? ` · "${s.title.slice(0, 45)}"` : "";
				const branch = s.gitBranch ? ` (${s.gitBranch})` : "";
				return `${toolBadge} ${idStr} · ${relTime}${title}${branch}`;
			});

			const choice = await ctx.ui.select("Select session to hand off to Pi:", labels);
			if (!choice) {
				ctx.ui.notify("Handoff cancelled", "info");
				return;
			}

			const idx = labels.indexOf(choice);
			selectedSource = sessions[idx];
		}

		ctx.ui.notify(`Analyzing session ${selectedSource.id}...`, "info");
		const brief = await createHandoffBrief(selectedSource, ctx.cwd);

		if (!ctx.hasUI) {
			pi.sendUserMessage(brief.resumePrompt);
			return;
		}

		// Action options
		const actionOptions = [
			"🚀 Tag In (Continue in current session)",
			"🆕 New Session with Handoff Brief",
			"✏️ Edit Handoff Prompt before running",
			"📋 Preview Handoff Brief in Widget",
		];

		const action = await ctx.ui.select(
			`Ready to hand off [${selectedSource.tool}] ${selectedSource.id.slice(0, 8)}:`,
			actionOptions,
		);

		if (!action) {
			ctx.ui.notify("Handoff cancelled", "info");
			return;
		}

		if (action.startsWith("🚀")) {
			// Continue directly in current session
			pi.sendUserMessage(brief.resumePrompt);
		} else if (action.startsWith("🆕")) {
			// Start new fresh session with the handoff brief
			const parentFile = ctx.sessionManager.getSessionFile();
			await ctx.newSession({
				parentSession: parentFile,
				withSession: async (newCtx) => {
					await newCtx.sendUserMessage(brief.resumePrompt);
				},
			});
		} else if (action.startsWith("✏️")) {
			// Open editor to let user inspect and adjust
			const editedPrompt = await ctx.ui.editor(
				"TagTeam Handoff Prompt — Edit and Save to Continue:",
				brief.resumePrompt,
			);
			if (editedPrompt && editedPrompt.trim()) {
				pi.sendUserMessage(editedPrompt);
			} else {
				ctx.ui.notify("Prompt was empty, cancelled.", "info");
			}
		} else if (action.startsWith("📋")) {
			// Show summary widget
			ctx.ui.setWidget("tagteam", brief.markdownSummary.split("\n"));
			ctx.ui.notify("Handoff brief displayed in widget", "info");
		}
	};

	// Register /tagteam
	pi.registerCommand("tagteam", {
		description: "Tag Pi in: Hand off a Claude Code or Codex session to Pi (/tagteam [latest|claude|codex|--all])",
		handler: async (args, ctx) => handleCommand(args, ctx, "both"),
	});

	// Register /handoff alias
	pi.registerCommand("handoff", {
		description: "Hand off a Claude Code or Codex session to Pi",
		handler: async (args, ctx) => handleCommand(args, ctx, "both"),
	});

	// Register /relay alias
	pi.registerCommand("relay", {
		description: "Relay Claude Code or Codex session to Pi",
		handler: async (args, ctx) => handleCommand(args, ctx, "both"),
	});

	// Register /claude shortcut
	pi.registerCommand("claude", {
		description: "Hand off a recent Claude Code session to Pi",
		handler: async (args, ctx) => handleCommand(args, ctx, "claude"),
	});

	// Register /codex shortcut
	pi.registerCommand("codex", {
		description: "Hand off a recent OpenAI Codex session to Pi",
		handler: async (args, ctx) => handleCommand(args, ctx, "codex"),
	});
}
