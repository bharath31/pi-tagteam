<p align="center">
  <img src="assets/banner.svg" alt="pi-tagteam banner" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pi-tagteam"><img src="https://img.shields.io/npm/v/pi-tagteam.svg?color=f59e0b" alt="npm version"></a>
  <a href="https://github.com/bharath31/pi-tagteam/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://pi.dev/packages"><img src="https://img.shields.io/badge/pi--package-ready-38bdf8.svg" alt="Pi Package"></a>
  <a href="https://github.com/bharath31/pi-tagteam/actions/workflows/ci.yml"><img src="https://github.com/bharath31/pi-tagteam/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

---

# Don't let a 4-hour rate limit kill your flow. 🤝

> When Claude Code or Codex stalls mid-refactor, **`pi-tagteam`** transfers dirty worktrees, in-flight subagents, and session state into Pi in one keystroke.

<p align="center">
  <img src="assets/preview.svg" alt="pi-tagteam dual chamber relay preview" width="100%">
</p>

```bash
pi install npm:pi-tagteam
```

---

## 🛑 The Problem

You are 80% through a 20-file refactor. Your coding agent ran three subagents, modified database queries, created a new migration in an isolated worktree, and was about to run the test suite.

Then you hit a wall:

```
⚠️ Error: You have hit your usage limit. Resets at 1:40 PM (in 4 hours).
```

Your options until now:
1. **Wait 4 hours** for your quota to reset and lose your train of thought.
2. **Start over in another CLI** and waste 20 minutes manually copy-pasting diffs, terminal history, and re-explaining the architecture.
3. **Lose uncommitted work** trapped inside hidden subagent worktrees (`.claude/worktrees/*`).

---

## ⚡ The Fix: Run `/tagteam`

With **`pi-tagteam`**, you pass the baton directly to Pi. It parses the real underlying session storage on your disk and produces a high-density, structured handoff brief.

```bash
/tagteam latest
```

```
[Claude] f4fca288 · 12m ago · "Fix durable audit reports & recovery storage" (main)
✓ Ingested original goal & stopping point
✓ Salvaged worktree: .claude/worktrees/agent-afd3e361dfa64 (11 files, +1411/-244)
✓ Reconnected 2 subagent execution goals
✓ Zero tokens wasted · Context intact

pi: "Applying migration and finishing recovery routes..."
Running tests: 238/238 passing (100% green)
```

---

## 🎯 What Gets Salvaged

| What gets salvaged | Why it matters |
|---|---|
| **💾 Uncommitted Git Worktrees** | Discovers dirty changes and untracked files across your main branch and any subagent worktrees (`.claude/worktrees/*`). No orphaned code. |
| **🤖 In-Flight Subagents** | Extracts subagent descriptions, target files, and completion status so Pi continues parallel tasks without re-doing finished work. |
| **📋 Stored Checklists & Tasks** | Captures structured task lists and todo checkpoints maintained by the previous agent. |
| **🎯 Goal & Stopping Point** | Preserves your original intent and the exact file/line where the last agent was interrupted. |
| **⚡ High-Density Resume Brief** | No 100k-token JSON bloat. Pi receives a clean, structured brief optimized for immediate execution. |

---

## 🚀 Quickstart

### 1. Install the extension

```bash
# Global install (recommended)
pi install npm:pi-tagteam

# Or try once without installing
pi -e npm:pi-tagteam
```

### 2. Take over an interrupted session

Inside any project directory in Pi, run:

```bash
/tagteam
```

Select your session from the interactive picker, pick an action, and Pi gets straight to work.

---

## 🎮 Command Reference

| Command | Action |
|---|---|
| `/tagteam` | Open interactive session picker for the current workspace |
| `/tagteam latest` | Instantly hand off the most recent session without prompting |
| `/tagteam claude` | Filter to Claude Code sessions only |
| `/tagteam codex` | Filter to OpenAI Codex sessions only |
| `/tagteam --all` | Search across all projects on your machine |
| `/tagteam 12` | Scan for sessions updated within the last 12 hours |
| `/tagteam <sessionId>` | Target a specific session ID or filename directly |
| `/handoff` / `/relay` | Quick aliases for `/tagteam` |
| `/claude` | Direct shortcut for `/tagteam claude` |
| `/codex` | Direct shortcut for `/tagteam codex` |

---

## 🤖 Natural Language Handoff (Autonomous Tool)

You don't even have to remember the slash command. Pi's model has access to the **`tagteam_handoff`** tool.

Just tell Pi naturally:

> *"Hey, I was working on PR #45 in Claude Code earlier and hit my rate limit. Can you take over?"*

Pi will automatically discover the session, inspect the uncommitted worktrees, ingest the state, and resume the task.

---

## 💡 Automatic Startup Detection

When you open Pi in a project where a Claude Code or Codex session was interrupted in the last 2 hours, `pi-tagteam` displays a subtle notice:

```
💡 Recent Claude Code session detected (15m ago: "Fix durable reports in PR #45"). Run /tagteam to take over.
```

---

## 🔍 Supported Data Sources

### Claude Code (`~/.claude/`)
- **Transcripts:** `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
- **Subagents:** `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/*.meta.json` & `.jsonl`
- **Tasks & Checklists:** `~/.claude/tasks/<session-id>/*.json`
- **Isolated Worktrees:** `<project>/.claude/worktrees/*`
- **Global History:** `~/.claude/history.jsonl`

### OpenAI Codex (`~/.codex/`)
- **Active Rollouts:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- **Archived Sessions:** `~/.codex/archived_sessions/rollout-*.jsonl`
- **Thread Index:** `~/.codex/session_index.jsonl`
- **Rate Limit Tracking:** Captures quota percentages, reset timestamps, and token counts.

---

## ❓ Frequently Asked Questions

#### Does `pi-tagteam` modify my git history or files?
No. `pi-tagteam` is strictly read-only during discovery and brief construction. It reads your session stores, logs, and `git status` output. Any changes made to your codebase are made by Pi under your control.

#### What happens to isolated worktrees created by subagents?
Claude Code creates worktrees under `.claude/worktrees/agent-<id>`. `pi-tagteam` scans those paths, surfaces any uncommitted files in the handoff brief, and points Pi directly to them so you can commit, merge, or salvage the work.

#### Can I edit the handoff prompt before Pi runs?
Yes. When you select a session in `/tagteam`, choose **"✏️ Edit Handoff Prompt before running"** to open Pi's built-in editor and tweak instructions before execution.

---

## 🛠️ Contributing & Local Testing

```bash
# Clone repository
git clone https://github.com/bharath31/pi-tagteam.git
cd pi-tagteam

# Install dependencies and build
npm install
npm run build

# Run unit tests (19 test cases)
npm test

# Test extension in Pi
pi -e ./dist/index.js
```

---

## 📄 License

[MIT](LICENSE) © Bharath
