/**
 * OpenAI Codex session parser and extractor
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type {
	ConversationTurn,
	ParsedSession,
	SessionSource,
} from "./types.js";

export const CODEX_LIMIT_MARKERS = [
	"rate limit",
	"token limit",
	"context limit",
	"rate_limit_reached",
	"credits exhausted",
	"usage limit",
	"resets at",
	"too many requests",
	"429",
];

export function detectCodexInterruptions(texts: string[]): string[] {
	const hits = new Set<string>();
	for (const text of texts) {
		const lower = text.toLowerCase();
		for (const marker of CODEX_LIMIT_MARKERS) {
			if (lower.includes(marker)) {
				hits.add(marker);
			}
		}
	}
	return [...hits];
}

/**
 * Extract session ID from Codex rollout filename
 * format: rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl
 */
export function extractCodexSessionId(filename: string): string {
	const base = basename(filename, ".jsonl");
	const parts = base.split("-");
	if (parts.length >= 5) {
		// e.g. 019f285f-956e-73e3-9fb9-5acdacb6aa6b
		const last5 = parts.slice(-5).join("-");
		if (last5.length === 36) return last5;
	}
	return base;
}

/**
 * Parse a Codex JSONL line
 */
export function parseCodexJsonLine(line: string): {
	type?: string;
	timestamp?: string;
	role?: "user" | "assistant" | "developer";
	text?: string;
	toolCall?: { name: string; argsSummary?: string };
	toolResult?: { summary?: string; isError?: boolean };
	cwd?: string;
	tokenUsage?: {
		input?: number;
		output?: number;
		total?: number;
	};
	rateLimits?: {
		usedPercent?: number;
		resetsAt?: string;
		type?: string;
	};
} | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;

	try {
		const entry = JSON.parse(trimmed);
		const type = entry.type;
		const timestamp = entry.timestamp;
		const payload = entry.payload;

		if (!payload) return { type, timestamp };

		// Handle object payload (modern Codex)
		if (typeof payload === "object") {
			// 1. turn_context: cwd and config
			if (type === "turn_context" || payload.type === "turn_context") {
				return {
					type: "turn_context",
					timestamp,
					cwd: payload.cwd || payload.workspace_roots?.[0],
				};
			}

			// 2. event_msg: token counts / rate limits / user_message / agent_message
			if (type === "event_msg") {
				if (payload.type === "token_count") {
					const info = payload.info;
					const rateLimits = payload.rate_limits;
					return {
						type: "token_count",
						timestamp,
						tokenUsage: {
							input: info?.total_token_usage?.input_tokens,
							output: info?.total_token_usage?.output_tokens,
							total: info?.total_token_usage?.total_tokens,
						},
						rateLimits: {
							usedPercent: rateLimits?.primary?.used_percent,
							resetsAt: rateLimits?.primary?.resets_at
								? new Date(rateLimits.primary.resets_at * 1000).toISOString()
								: undefined,
							type: rateLimits?.rate_limit_reached_type || undefined,
						},
					};
				}
				if (payload.type === "user_message" && typeof payload.message === "string") {
					return {
						type: "user_message",
						timestamp,
						role: "user",
						text: payload.message.trim(),
					};
				}
				if (payload.type === "agent_message" && typeof payload.message === "string") {
					return {
						type: "agent_message",
						timestamp,
						role: "assistant",
						text: payload.message.trim(),
					};
				}
			}

			// 3. response_item: message / tool calls
			if (type === "response_item") {
				if (payload.type === "message" && payload.role) {
					let text = "";
					if (Array.isArray(payload.content)) {
						for (const c of payload.content) {
							if (c.text) text += c.text;
						}
					}
					// Extract cwd from <environment_context>
					let foundCwd: string | undefined;
					if (text.includes("<cwd>")) {
						const match = text.match(/<cwd>(.*?)<\/cwd>/);
						if (match) foundCwd = match[1].trim();
					}

					return {
						type: "message",
						timestamp,
						role: payload.role === "assistant" ? "assistant" : payload.role === "user" ? "user" : "developer",
						text: text.trim(),
						cwd: foundCwd,
					};
				}

				if (payload.type === "custom_tool_call") {
					let argsSummary: string | undefined;
					if (typeof payload.input === "string") {
						argsSummary = payload.input.slice(0, 100);
					} else if (payload.input && typeof payload.input === "object") {
						argsSummary = JSON.stringify(payload.input).slice(0, 100);
					}
					return {
						type: "custom_tool_call",
						timestamp,
						role: "assistant",
						toolCall: {
							name: payload.name || "tool",
							argsSummary,
						},
					};
				}

				if (payload.type === "custom_tool_call_output") {
					let summary: string | undefined;
					if (Array.isArray(payload.output)) {
						for (const o of payload.output) {
							if (o.text) summary = (summary ? summary + "\n" : "") + o.text;
						}
					}
					return {
						type: "custom_tool_call_output",
						timestamp,
						toolResult: {
							summary: summary?.slice(0, 200),
							isError: false,
						},
					};
				}
			}
		}

		// Handle string payload (fallback / legacy format)
		if (typeof payload === "string") {
			const typeM = payload.match(/'type':\s*'([^']*)'/);
			const roleM = payload.match(/'role':\s*'([^']*)'/);
			const textM = payload.match(/'text':\s*'((?:[^'\\]|\\.)*)'/);
			const toolM = payload.match(/'(?:tool_name|name)':\s*'([^']*)'/);
			const cwdM = payload.match(/'cwd':\s*'([^']*)'/);

			const role = roleM ? (roleM[1] as "user" | "assistant" | "developer") : undefined;
			const rawText = textM ? textM[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\") : undefined;
			const tool = toolM ? toolM[1] : undefined;
			const cwd = cwdM ? cwdM[1].replace(/\\'/g, "'") : undefined;

			return {
				type: typeM ? typeM[1] : undefined,
				timestamp,
				role,
				text: rawText,
				toolCall: tool ? { name: tool } : undefined,
				cwd,
			};
		}

		return { type, timestamp };
	} catch {
		return undefined;
	}
}

/**
 * Parse full Codex session file
 */
export async function parseCodexSession(
	source: SessionSource,
	maxLines = 800,
): Promise<ParsedSession> {
	let initialPrompt: string | undefined;
	let lastUserPrompt: string | undefined;
	let lastAssistantText: string | undefined;
	let detectedCwd = source.cwd;
	let tokenUsage = source.tokenUsage;
	let rateLimitInfo: ParsedSession["rateLimitInfo"];
	const interruptionMarkers: string[] = [];
	const toolUsageSummary: Record<string, number> = {};
	const turns: ConversationTurn[] = [];

	let content = "";
	try {
		content = await readFile(source.file, "utf8");
	} catch {
		/* empty */
	}

	const allLines = content.split("\n").filter((l) => l.trim().length > 0);
	const lines = allLines.slice(Math.max(0, allLines.length - maxLines));

	for (const line of lines) {
		const parsed = parseCodexJsonLine(line);
		if (!parsed) continue;

		if (parsed.cwd && !detectedCwd) {
			detectedCwd = parsed.cwd;
		}

		if (parsed.tokenUsage) {
			tokenUsage = parsed.tokenUsage;
		}

		if (parsed.rateLimits) {
			rateLimitInfo = parsed.rateLimits;
			if (parsed.rateLimits.type) {
				interruptionMarkers.push(`Rate limit reached: ${parsed.rateLimits.type}`);
			}
			if (parsed.rateLimits.usedPercent && parsed.rateLimits.usedPercent >= 95) {
				interruptionMarkers.push(`High quota usage: ${parsed.rateLimits.usedPercent}%`);
			}
		}

		if (parsed.role === "user" && parsed.text) {
			// Skip internal environment context blocks
			if (!parsed.text.startsWith("<environment_context>") && !parsed.text.startsWith("<collaboration_mode>")) {
				if (!initialPrompt) initialPrompt = parsed.text;
				lastUserPrompt = parsed.text;
				turns.push({
					role: "user",
					text: parsed.text,
					timestamp: parsed.timestamp,
				});
			}
		} else if (parsed.role === "assistant" && (parsed.text || parsed.toolCall)) {
			if (parsed.text) {
				lastAssistantText = parsed.text;
			}
			if (parsed.toolCall) {
				toolUsageSummary[parsed.toolCall.name] = (toolUsageSummary[parsed.toolCall.name] || 0) + 1;
			}
			turns.push({
				role: "assistant",
				text: parsed.text,
				toolCalls: parsed.toolCall ? [parsed.toolCall] : undefined,
				toolResults: parsed.toolResult ? [parsed.toolResult] : undefined,
				timestamp: parsed.timestamp,
			});
		}

		if (parsed.text) {
			const hits = detectCodexInterruptions([parsed.text]);
			if (hits.length > 0) {
				interruptionMarkers.push(...hits);
			}
		}
	}

	return {
		source: {
			...source,
			cwd: detectedCwd || source.cwd,
			title: source.title || (initialPrompt ? initialPrompt.slice(0, 80) : undefined),
			turnCount: turns.length,
			tokenUsage,
		},
		initialPrompt,
		lastUserPrompt,
		lastAssistantText,
		recentTurns: turns.slice(-10),
		toolUsageSummary,
		interruptionMarkers: [...new Set(interruptionMarkers)],
		subagents: [],
		tasks: [],
		uncommittedWork: [],
		rateLimitInfo,
	};
}
