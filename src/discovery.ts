/**
 * Session discovery engine for Claude Code and OpenAI Codex
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { encodeClaudeProjectDir, encodeClaudeProjectDirSimple, parseClaudeJsonLine } from "./claude.js";
import { extractCodexSessionId, parseCodexJsonLine } from "./codex.js";
import type { DiscoveryOptions, SessionSource } from "./types.js";

const HOME = homedir();

/**
 * Load Codex session index map: sessionId -> thread_name
 */
export async function loadCodexSessionIndex(): Promise<Map<string, { threadName?: string; updatedAt?: string }>> {
	const map = new Map<string, { threadName?: string; updatedAt?: string }>();
	const indexPath = join(HOME, ".codex", "session_index.jsonl");

	try {
		const content = await readFile(indexPath, "utf8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const item = JSON.parse(trimmed);
				if (item.id) {
					map.set(item.id, {
						threadName: item.thread_name,
						updatedAt: item.updated_at,
					});
				}
			} catch {
				/* skip bad line */
			}
		}
	} catch {
		/* no index */
	}

	return map;
}

/**
 * Discover Claude Code sessions
 */
export async function discoverClaudeSessions(options: DiscoveryOptions): Promise<SessionSource[]> {
	const results: SessionSource[] = [];
	const projectsBase = join(HOME, ".claude", "projects");
	const maxAgeMs = (options.maxAgeHours ?? 48) * 3600_000;
	const now = Date.now();

	let projectDirsToScan: string[] = [];

	if (options.allProjects) {
		try {
			const entries = await readdir(projectsBase);
			projectDirsToScan = entries.map((e) => join(projectsBase, e));
		} catch {
			return [];
		}
	} else {
		// Try multiple encodings of cwd
		const enc1 = join(projectsBase, encodeClaudeProjectDir(options.cwd));
		const enc2 = join(projectsBase, encodeClaudeProjectDirSimple(options.cwd));
		const candidateSet = new Set<string>([enc1, enc2]);

		try {
			const entries = await readdir(projectsBase);
			for (const e of entries) {
				const full = join(projectsBase, e);
				if (candidateSet.has(full)) {
					projectDirsToScan.push(full);
				}
			}
		} catch {
			return [];
		}

		// If no direct encoding matched, scan all project dirs to match cwd in file contents
		if (projectDirsToScan.length === 0) {
			try {
				const entries = await readdir(projectsBase);
				projectDirsToScan = entries.map((e) => join(projectsBase, e));
			} catch {
				return [];
			}
		}
	}

	for (const pDir of projectDirsToScan) {
		let files: string[] = [];
		try {
			files = await readdir(pDir);
		} catch {
			continue;
		}

		for (const file of files) {
			if (!file.endsWith(".jsonl")) continue;

			const filePath = join(pDir, file);
			const sessionId = basename(file, ".jsonl");

			if (options.sessionId && !sessionId.includes(options.sessionId)) {
				continue;
			}

			try {
				const st = await stat(filePath);
				if (now - st.mtimeMs > maxAgeMs) continue;

				// Read a quick slice to extract title, branch, cwd
				const headContent = await readFile(filePath, "utf8");
				const lines = headContent.split("\n").filter(Boolean);
				const headLines = lines.slice(0, 30);
				const tailLines = lines.slice(-20);

				let fileCwd: string | undefined;
				let gitBranch: string | undefined;
				let title: string | undefined;

				for (const l of headLines.concat(tailLines)) {
					const parsed = parseClaudeJsonLine(l);
					if (!parsed) continue;
					if (parsed.cwd && !fileCwd) fileCwd = parsed.cwd;
					if (parsed.gitBranch && !gitBranch) gitBranch = parsed.gitBranch;
					if (parsed.aiTitle && !title) title = parsed.aiTitle;
				}

				// If we are filtering by project (allProjects is false), verify cwd match
				if (!options.allProjects && fileCwd && fileCwd !== options.cwd) {
					continue;
				}

				results.push({
					id: sessionId,
					tool: "claude",
					file: filePath,
					cwd: fileCwd || options.cwd,
					mtime: st.mtimeMs,
					size: st.size,
					title,
					gitBranch,
				});
			} catch {
				/* skip unreadable file */
			}
		}
	}

	return results;
}

/**
 * Discover Codex sessions
 */
export async function discoverCodexSessions(options: DiscoveryOptions): Promise<SessionSource[]> {
	const results: SessionSource[] = [];
	const codexBase = join(HOME, ".codex");
	const sessionsBase = join(codexBase, "sessions");
	const archivedBase = join(codexBase, "archived_sessions");
	const maxAgeMs = (options.maxAgeHours ?? 48) * 3600_000;
	const now = Date.now();

	const sessionIndex = await loadCodexSessionIndex();

	const sessionFiles: string[] = [];

	// 1. Walk ~/.codex/sessions (date-partitioned directories)
	async function walk(dir: string, depth = 0): Promise<void> {
		if (depth > 5) return;
		let entries: string[] = [];
		try {
			entries = await readdir(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			const full = join(dir, entry);
			try {
				const st = await stat(full);
				if (st.isDirectory()) {
					await walk(full, depth + 1);
				} else if (entry.endsWith(".jsonl") && entry.startsWith("rollout-")) {
					if (now - st.mtimeMs <= maxAgeMs) {
						sessionFiles.push(full);
					}
				}
			} catch {
				/* skip */
			}
		}
	}

	await walk(sessionsBase);

	// 2. Also check archived sessions
	try {
		const archived = await readdir(archivedBase);
		for (const file of archived) {
			if (file.endsWith(".jsonl") && file.startsWith("rollout-")) {
				const full = join(archivedBase, file);
				try {
					const st = await stat(full);
					if (now - st.mtimeMs <= maxAgeMs) {
						sessionFiles.push(full);
					}
				} catch {
					/* skip */
				}
			}
		}
	} catch {
		/* no archived directory */
	}

	// 3. Inspect found session files
	for (const filePath of sessionFiles) {
		const filename = basename(filePath);
		const sessionId = extractCodexSessionId(filename);

		if (options.sessionId && !sessionId.includes(options.sessionId) && !filename.includes(options.sessionId)) {
			continue;
		}

		try {
			const st = await stat(filePath);
			const content = await readFile(filePath, "utf8");
			const lines = content.split("\n").filter(Boolean);
			const headLines = lines.slice(0, 30);
			const tailLines = lines.slice(-20);

			let detectedCwd: string | undefined;
			let userPrompt: string | undefined;

			for (const l of headLines.concat(tailLines)) {
				const parsed = parseCodexJsonLine(l);
				if (!parsed) continue;
				if (parsed.cwd && !detectedCwd) detectedCwd = parsed.cwd;
				if (parsed.role === "user" && parsed.text && !userPrompt) {
					if (!parsed.text.startsWith("<environment_context>") && !parsed.text.startsWith("<collaboration_mode>")) {
						userPrompt = parsed.text;
					}
				}
			}

			if (!options.allProjects && detectedCwd && detectedCwd !== options.cwd) {
				continue;
			}

			const indexMeta = sessionIndex.get(sessionId);
			const title = indexMeta?.threadName || (userPrompt ? userPrompt.slice(0, 80) : undefined);

			results.push({
				id: sessionId,
				tool: "codex",
				file: filePath,
				cwd: detectedCwd,
				mtime: st.mtimeMs,
				size: st.size,
				title,
			});
		} catch {
			/* skip unreadable file */
		}
	}

	return results;
}

/**
 * Discover all sessions matching criteria across Claude and Codex
 */
export async function discoverSessions(options: DiscoveryOptions): Promise<SessionSource[]> {
	const tool = options.tool ?? "both";
	const max = options.maxResults ?? 15;

	const claudePromise =
		tool === "both" || tool === "claude" ? discoverClaudeSessions(options) : Promise.resolve([]);
	const codexPromise =
		tool === "both" || tool === "codex" ? discoverCodexSessions(options) : Promise.resolve([]);

	const [claudeSessions, codexSessions] = await Promise.all([claudePromise, codexPromise]);

	const all = [...claudeSessions, ...codexSessions];
	all.sort((a, b) => b.mtime - a.mtime);

	return all.slice(0, max);
}
