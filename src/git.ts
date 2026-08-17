/**
 * Git & Worktree inspection helpers
 */

import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { UncommittedWork } from "./types.js";

const execFileP = promisify(execFile);

/**
 * Execute a git command in a specific directory safely
 */
export async function runGit(
	cwd: string,
	args: string[],
	timeoutMs = 8000,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
	try {
		const { stdout, stderr } = await execFileP("git", ["-C", cwd, ...args], {
			timeout: timeoutMs,
			maxBuffer: 512 * 1024,
		});
		return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
	} catch (err: any) {
		return {
			stdout: err?.stdout?.toString()?.trim() || "",
			stderr: err?.stderr?.toString()?.trim() || err?.message || "",
			ok: false,
		};
	}
}

/**
 * Get current git branch
 */
export async function getGitBranch(cwd: string): Promise<string | undefined> {
	// Try symbolic-ref first (works even on empty repositories before first commit)
	const symRes = await runGit(cwd, ["symbolic-ref", "--short", "HEAD"]);
	if (symRes.ok && symRes.stdout) {
		return symRes.stdout;
	}

	const res = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	return res.ok && res.stdout ? res.stdout : undefined;
}

/**
 * Get git status --short output and categorize modified vs untracked
 */
export async function getGitStatus(cwd: string): Promise<{
	statusLines: string[];
	modifiedFiles: string[];
	untrackedFiles: string[];
}> {
	const res = await runGit(cwd, ["status", "--short"]);
	if (!res.ok || !res.stdout) {
		return { statusLines: [], modifiedFiles: [], untrackedFiles: [] };
	}

	const statusLines = res.stdout
		.split("\n")
		.map((l) => l.trimEnd())
		.filter(Boolean);

	const modifiedFiles: string[] = [];
	const untrackedFiles: string[] = [];

	for (const line of statusLines) {
		const code = line.slice(0, 2).trim();
		const file = line.slice(3).trim();
		if (!file) continue;

		if (code.includes("?") || line.startsWith("??")) {
			untrackedFiles.push(file);
		} else {
			modifiedFiles.push(file);
		}
	}

	return { statusLines, modifiedFiles, untrackedFiles };
}

/**
 * Get git diff --stat summary
 */
export async function getGitDiffStat(cwd: string): Promise<string | undefined> {
	const res = await runGit(cwd, ["diff", "--stat"]);
	if (res.ok && res.stdout) {
		const lines = res.stdout.split("\n");
		return lines[lines.length - 1]?.trim();
	}
	return undefined;
}

/**
 * Discover git worktrees via `git worktree list`
 */
export async function getGitWorktreeList(
	cwd: string,
): Promise<Array<{ path: string; branch?: string; hash?: string }>> {
	const res = await runGit(cwd, ["worktree", "list", "--porcelain"]);
	if (!res.ok || !res.stdout) return [];

	const worktrees: Array<{ path: string; branch?: string; hash?: string }> = [];
	const blocks = res.stdout.split("\n\n");

	for (const block of blocks) {
		let path = "";
		let branch: string | undefined;
		let hash: string | undefined;

		for (const line of block.split("\n")) {
			if (line.startsWith("worktree ")) {
				path = line.slice(9).trim();
			} else if (line.startsWith("branch ")) {
				branch = line.slice(7).replace("refs/heads/", "").trim();
			} else if (line.startsWith("HEAD ")) {
				hash = line.slice(5).trim();
			}
		}

		if (path) {
			worktrees.push({ path, branch, hash });
		}
	}

	return worktrees;
}

/**
 * Collect all uncommitted work across main repo and any isolated agent worktrees
 */
export async function collectAllUncommittedWork(
	targetCwd: string,
	additionalWorktreePaths: string[] = [],
): Promise<UncommittedWork[]> {
	const results: UncommittedWork[] = [];
	const visitedPaths = new Set<string>();

	// 1. Check main repository
	const mainBranch = await getGitBranch(targetCwd);
	const mainStatus = await getGitStatus(targetCwd);
	const mainDiffStat = await getGitDiffStat(targetCwd);
	visitedPaths.add(targetCwd);

	if (mainStatus.statusLines.length > 0) {
		results.push({
			worktree: targetCwd,
			branch: mainBranch,
			isIsolatedWorktree: false,
			statusLines: mainStatus.statusLines.slice(0, 50),
			statSummary: mainDiffStat,
			modifiedFiles: mainStatus.modifiedFiles,
			untrackedFiles: mainStatus.untrackedFiles,
		});
	}

	// 2. Check Claude Code worktrees: <targetCwd>/.claude/worktrees/*
	const claudeWtBase = join(targetCwd, ".claude", "worktrees");
	try {
		const entries = await readdir(claudeWtBase);
		for (const entry of entries) {
			const wtPath = join(claudeWtBase, entry);
			if (visitedPaths.has(wtPath)) continue;
			visitedPaths.add(wtPath);

			try {
				const st = await stat(wtPath);
				if (!st.isDirectory()) continue;

				const branch = await getGitBranch(wtPath);
				const status = await getGitStatus(wtPath);
				const statSummary = await getGitDiffStat(wtPath);

				if (status.statusLines.length > 0) {
					results.push({
						worktree: wtPath,
						branch,
						isIsolatedWorktree: true,
						statusLines: status.statusLines.slice(0, 50),
						statSummary,
						modifiedFiles: status.modifiedFiles,
						untrackedFiles: status.untrackedFiles,
					});
				}
			} catch {
				/* skip inaccessible worktree */
			}
		}
	} catch {
		/* no .claude/worktrees directory */
	}

	// 3. Check any additional worktrees passed from subagent metadata
	for (const wtPath of additionalWorktreePaths) {
		if (!wtPath || visitedPaths.has(wtPath)) continue;
		visitedPaths.add(wtPath);

		try {
			const st = await stat(wtPath);
			if (!st.isDirectory()) continue;

			const branch = await getGitBranch(wtPath);
			const status = await getGitStatus(wtPath);
			const statSummary = await getGitDiffStat(wtPath);

			if (status.statusLines.length > 0) {
				results.push({
					worktree: wtPath,
					branch,
					isIsolatedWorktree: true,
					statusLines: status.statusLines.slice(0, 50),
					statSummary,
					modifiedFiles: status.modifiedFiles,
					untrackedFiles: status.untrackedFiles,
				});
			}
		} catch {
			/* skip */
		}
	}

	return results;
}
