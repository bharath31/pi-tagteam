---
name: tagteam
description: Resume stalled Claude Code or OpenAI Codex coding sessions in Pi, salvage uncommitted git changes from isolated subagent worktrees, and continue in-flight multi-step tasks.
---

# TagTeam: Cross-Agent Session Handoff & Worktree Salvage

Use this skill when:
- The user mentions a previous task started in Claude Code or OpenAI Codex that hit rate limits, crashed, or was interrupted.
- The user asks to "take over from Claude/Codex", "resume what I was doing earlier", "continue the refactor", or "pass the baton".
- You need to locate uncommitted files or migrations stranded inside isolated subagent worktrees (`.claude/worktrees/*`).

## Procedural Workflow

### Step 1: Discover & Ingest Session State
When asked to resume prior agent work, invoke the `tagteam_handoff` tool:
```typescript
tagteam_handoff({ tool: "both", maxAgeHours: 48, format: "brief" })
```
This inspects on-disk session logs (`~/.claude/projects/` and `~/.codex/sessions/`) and returns:
1. The original goal and initial prompt.
2. The exact stopping point (last assistant thought and failed tool).
3. Status of in-flight subagents (`subagents/*.meta.json`).
4. Trapped diffs in isolated worktrees (`.claude/worktrees/*`).
5. Checklists and tasks (`~/.claude/tasks/`).

### Step 2: Salvage Worktree Diffs
Claude Code writes subagent changes into isolated git worktrees (`.claude/worktrees/agent-<id>`).
- If an uncommitted worktree is reported in the handoff brief, inspect its files before making changes in the main branch.
- Verify which files in the worktree are ready to be merged, committed, or discarded.

### Step 3: Verify & Execute
- Check existing git status in the root repository.
- Avoid re-executing steps marked as completed in the subagent rollouts.
- Drive the remaining tasks to completion and run tests.
