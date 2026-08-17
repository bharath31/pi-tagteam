/**
 * pi-tagteam: Types and Interfaces
 */

export type AgentToolType = "claude" | "codex";

export interface SessionSource {
	id: string;
	tool: AgentToolType;
	file: string;
	cwd?: string;
	mtime: number;
	size: number;
	title?: string;
	gitBranch?: string;
	interruptedReason?: string;
	turnCount?: number;
	messageCount?: number;
	tokenUsage?: {
		input?: number;
		output?: number;
		total?: number;
		cached?: number;
	};
}

export interface UncommittedWork {
	worktree: string;
	branch?: string;
	isIsolatedWorktree: boolean;
	statusLines: string[];
	statSummary?: string;
	modifiedFiles: string[];
	untrackedFiles: string[];
}

export interface SubagentInfo {
	id: string;
	agentType: string;
	description?: string;
	status: "running" | "completed" | "interrupted" | "failed" | "ended" | "unknown";
	worktreePath?: string;
	worktreeBranch?: string;
	lastOutput?: string;
	error?: string;
}

export interface TaskItem {
	id?: string;
	subject: string;
	status: "completed" | "in_progress" | "pending" | "failed" | string;
	updatedAt?: string;
}

export interface ConversationTurn {
	role: "user" | "assistant";
	text?: string;
	toolCalls?: Array<{ name: string; argsSummary?: string }>;
	toolResults?: Array<{ name?: string; summary?: string; isError?: boolean }>;
	timestamp?: string;
}

export interface ParsedSession {
	source: SessionSource;
	initialPrompt?: string;
	lastUserPrompt?: string;
	lastAssistantText?: string;
	recentTurns: ConversationTurn[];
	toolUsageSummary: Record<string, number>;
	interruptionMarkers: string[];
	subagents: SubagentInfo[];
	tasks: TaskItem[];
	uncommittedWork: UncommittedWork[];
	plans?: string[];
	rateLimitInfo?: {
		resetsAt?: string;
		usedPercent?: number;
		type?: string;
	};
}

export interface HandoffBrief {
	session: ParsedSession;
	resumePrompt: string;
	markdownSummary: string;
	stats: {
		toolsUsed: number;
		uncommittedFiles: number;
		subagentsCount: number;
		tasksCount: number;
		recentTurnsCount: number;
	};
}

export interface DiscoveryOptions {
	cwd: string;
	tool?: "claude" | "codex" | "both";
	maxAgeHours?: number;
	maxResults?: number;
	allProjects?: boolean;
	sessionId?: string;
}
