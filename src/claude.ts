/**
 * Claude Code session parser and extractor
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
	ConversationTurn,
	ParsedSession,
	SessionSource,
	SubagentInfo,
	TaskItem,
} from "./types.js";

const HOME = homedir();

export const CLAUDE_LIMIT_MARKERS = [
	"session limit",
	"usage limit",
	"hit your limit",
	"rate limit",
	"context limit",
	"overwhelmed",
	"out of credits",
	"budget exhausted",
	"resets at",
	"resets in",
	"429",
	"too many requests",
];

/**
 * Encode a project directory path the way Claude Code does:
 * replaces `/`, `.`, and `_` with `-`
 */
export function encodeClaudeProjectDir(dir: string): string {
	return dir.replace(/[/._]/g, "-");
}

export function encodeClaudeProjectDirSimple(dir: string): string {
	return dir.replace(/\//g, "-");
}

/**
 * Check if text contains interruption or limit markers
 */
export function detectClaudeInterruptions(texts: string[]): string[] {
	const hits = new Set<string>();
	for (const text of texts) {
		const lower = text.toLowerCase();
		for (const marker of CLAUDE_LIMIT_MARKERS) {
			if (lower.includes(marker)) {
				// Try to extract full context line if it contains reset time
				if (marker.includes("reset") || marker.includes("limit")) {
					const lines = text.split("\n");
					for (const line of lines) {
						if (line.toLowerCase().includes(marker)) {
							hits.add(line.trim());
						}
					}
				} else {
					hits.add(marker);
				}
			}
		}
	}
	return [...hits];
}

interface RawClaudeLine {
	type?: string;
	timestamp?: string;
	gitBranch?: string;
	cwd?: string;
	sessionId?: string;
	aiTitle?: string;
	lastPrompt?: string;
	interruptedByShutdown?: boolean;
	message?: {
		role?: string;
		content?: any;
	};
}

/**
 * Parse a Claude Code JSONL line
 */
export function parseClaudeJsonLine(line: string): {
	type?: string;
	timestamp?: string;
	gitBranch?: string;
	cwd?: string;
	sessionId?: string;
	aiTitle?: string;
	role?: string;
	texts: string[];
	toolCalls: Array<{ name: string; argsSummary?: string }>;
	toolResults: Array<{ name?: string; summary?: string; isError?: boolean }>;
	interrupted?: boolean;
} | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;

	try {
		const obj = JSON.parse(trimmed) as RawClaudeLine;
		const texts: string[] = [];
		const toolCalls: Array<{ name: string; argsSummary?: string }> = [];
		const toolResults: Array<{ name?: string; summary?: string; isError?: boolean }> = [];

		if (obj.aiTitle) {
			return {
				type: "ai-title",
				aiTitle: obj.aiTitle,
				texts: [],
				toolCalls: [],
				toolResults: [],
			};
		}

		if (obj.interruptedByShutdown) {
			texts.push("[Request interrupted by user / shutdown]");
		}

		const msg = obj.message;
		const role = msg?.role;
		const content = msg?.content;

		if (typeof content === "string") {
			texts.push(content);
		} else if (Array.isArray(content)) {
			for (const item of content) {
				if (!item || typeof item !== "object") continue;

				if (item.type === "text" && typeof item.text === "string") {
					texts.push(item.text);
				} else if (item.type === "tool_use" && typeof item.name === "string") {
					let argsSummary: string | undefined;
					if (item.input && typeof item.input === "object") {
						const keys = Object.keys(item.input);
						if (keys.length === 1 && typeof (item.input as any)[keys[0]] === "string") {
							argsSummary = (item.input as any)[keys[0]];
						} else if (item.name === "bash" && typeof (item.input as any).command === "string") {
							argsSummary = (item.input as any).command;
						} else if (
							(item.name === "edit" || item.name === "write" || item.name === "read") &&
							typeof (item.input as any).path === "string"
						) {
							argsSummary = (item.input as any).path;
						} else {
							argsSummary = JSON.stringify(item.input).slice(0, 100);
						}
					}
					toolCalls.push({ name: item.name, argsSummary });
				} else if (item.type === "tool_result") {
					const isError = Boolean(item.is_error);
					let summary: string | undefined;
					if (typeof item.content === "string") {
						summary = item.content.slice(0, 200);
					} else if (Array.isArray(item.content)) {
						const textPart = item.content.find((p: any) => p?.type === "text");
						if (textPart && typeof textPart.text === "string") {
							summary = textPart.text.slice(0, 200);
						}
					}
					toolResults.push({ summary, isError });
				}
			}
		}

		return {
			type: obj.type,
			timestamp: obj.timestamp,
			gitBranch: obj.gitBranch,
			cwd: obj.cwd,
			sessionId: obj.sessionId,
			aiTitle: obj.aiTitle,
			role,
			texts,
			toolCalls,
			toolResults,
			interrupted: obj.interruptedByShutdown,
		};
	} catch {
		return undefined;
	}
}

/**
 * Fetch subagent status for a Claude Code session
 */
export async function getClaudeSubagents(
	sessionId: string,
	projectDirs: string[] = [],
): Promise<SubagentInfo[]> {
	const out: SubagentInfo[] = [];
	const projectsBase = join(HOME, ".claude", "projects");

	let candidates = projectDirs;
	if (candidates.length === 0) {
		try {
			const list = await readdir(projectsBase);
			candidates = list.map((p) => join(projectsBase, p));
		} catch {
			return out;
		}
	}

	for (const pDir of candidates) {
		const subagentsDir = join(pDir, sessionId, "subagents");
		let files: string[] = [];
		try {
			files = await readdir(subagentsDir);
		} catch {
			continue;
		}

		for (const name of files.filter((f) => f.endsWith(".meta.json"))) {
			try {
				const metaPath = join(subagentsDir, name);
				const raw = await readFile(metaPath, "utf8");
				const meta = JSON.parse(raw);
				const agentId = name.replace(/\.meta\.json$/, "");
				const rolloutFile = join(subagentsDir, `${agentId}.jsonl`);

				let status: SubagentInfo["status"] = "unknown";
				let lastOutput: string | undefined;

				try {
					const rolloutContent = await readFile(rolloutFile, "utf8");
					const lines = rolloutContent.split("\n").filter(Boolean);
					const tailLines = lines.slice(-20);
					const assistantTexts: string[] = [];

					for (const l of tailLines) {
						const parsed = parseClaudeJsonLine(l);
						if (parsed?.role === "assistant") {
							assistantTexts.push(...parsed.texts);
						}
					}

					if (assistantTexts.length > 0) {
						lastOutput = assistantTexts[assistantTexts.length - 1];
						const interruptions = detectClaudeInterruptions(assistantTexts);
						if (interruptions.length > 0) {
							status = "interrupted";
						} else {
							status = "completed";
						}
					} else {
						status = "running";
					}
				} catch {
					status = "running";
				}

				out.push({
					id: agentId,
					agentType: meta.agentType || meta.type || "agent",
					description: meta.description || meta.prompt,
					status,
					worktreePath: meta.worktreePath || meta.worktree,
					worktreeBranch: meta.worktreeBranch || meta.branch,
					lastOutput,
				});
			} catch {
				/* skip invalid meta */
			}
		}
	}

	return out;
}

/**
 * Fetch structured tasks maintained by Claude Code in ~/.claude/tasks/<sessionId>/
 */
export async function getClaudeTasks(sessionId: string): Promise<TaskItem[]> {
	const out: TaskItem[] = [];
	const tasksDir = join(HOME, ".claude", "tasks", sessionId);

	try {
		const files = await readdir(tasksDir);
		for (const name of files.filter((f) => f.endsWith(".json")).sort()) {
			try {
				const raw = await readFile(join(tasksDir, name), "utf8");
				const task = JSON.parse(raw);
				out.push({
					id: task.id || basename(name, ".json"),
					subject: task.subject || task.title || task.description || basename(name, ".json"),
					status: task.status || "pending",
					updatedAt: task.updated_at || task.created_at,
				});
			} catch {
				/* skip */
			}
		}
	} catch {
		/* no tasks directory */
	}

	return out;
}

/**
 * Parse full Claude Code session file
 */
export async function parseClaudeSession(
	source: SessionSource,
	maxLines = 800,
): Promise<ParsedSession> {
	let initialPrompt: string | undefined;
	let lastUserPrompt: string | undefined;
	let lastAssistantText: string | undefined;
	let gitBranch = source.gitBranch;
	let aiTitle = source.title;
	const interruptionMarkers: string[] = [];
	const toolUsageSummary: Record<string, number> = {};
	const turns: ConversationTurn[] = [];

	let content = "";
	try {
		content = await readFile(source.file, "utf8");
	} catch (err) {
		/* empty */
	}

	const allLines = content.split("\n").filter((l) => l.trim().length > 0);
	const lines = allLines.slice(Math.max(0, allLines.length - maxLines));

	for (const line of lines) {
		const parsed = parseClaudeJsonLine(line);
		if (!parsed) continue;

		if (parsed.aiTitle && !aiTitle) {
			aiTitle = parsed.aiTitle;
		}
		if (parsed.gitBranch) {
			gitBranch = parsed.gitBranch;
		}

		if (parsed.role === "user") {
			const text = parsed.texts.join("\n").trim();
			if (text && !text.startsWith("[Request interrupted")) {
				if (!initialPrompt) initialPrompt = text;
				lastUserPrompt = text;
			}
			turns.push({
				role: "user",
				text,
				timestamp: parsed.timestamp,
			});
		} else if (parsed.role === "assistant") {
			const text = parsed.texts.join("\n").trim();
			if (text) {
				lastAssistantText = text;
			}
			for (const tool of parsed.toolCalls) {
				toolUsageSummary[tool.name] = (toolUsageSummary[tool.name] || 0) + 1;
			}
			turns.push({
				role: "assistant",
				text,
				toolCalls: parsed.toolCalls,
				toolResults: parsed.toolResults,
				timestamp: parsed.timestamp,
			});
		}

		const hits = detectClaudeInterruptions(parsed.texts);
		if (hits.length > 0) {
			interruptionMarkers.push(...hits);
		}
		if (parsed.interrupted) {
			interruptionMarkers.push("Interrupted by user / process exit");
		}
	}

	// Fetch subagents and tasks
	const sessionId = source.id || basename(source.file, ".jsonl");
	const subagents = await getClaudeSubagents(sessionId);
	const tasks = await getClaudeTasks(sessionId);

	return {
		source: {
			...source,
			title: aiTitle || source.title || (initialPrompt ? initialPrompt.slice(0, 80) : undefined),
			gitBranch: gitBranch || source.gitBranch,
			turnCount: turns.length,
		},
		initialPrompt,
		lastUserPrompt,
		lastAssistantText,
		recentTurns: turns.slice(-10),
		toolUsageSummary,
		interruptionMarkers: [...new Set(interruptionMarkers)],
		subagents,
		tasks,
		uncommittedWork: [],
	};
}
