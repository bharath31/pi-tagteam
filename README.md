# pi-tagteam 🤝

> **Tag Pi in when Claude Code or OpenAI Codex hits usage limits, context exhaustion, or crashes.**  
> Seamlessly salvage uncommitted git work, in-flight subagents, structured task lists, and session transcripts directly into Pi.

---

## ⚡ Why pi-tagteam?

You're deep in the zone coding with **Claude Code** or **OpenAI Codex**. Suddenly:

```
⚠️ You have hit your session limit (resets in 4 hours).
```

Or the context window overflows, or a crash interrupts your agent mid-refactor.

Don't start over from scratch or manually copy-paste terminal history. **`pi-tagteam`** detects and parses the real state left behind in agent session stores and isolated worktrees:

- 🎯 **Original User Goal**: What you originally asked for.
- 🛑 **Exact Stopping Point**: The last thoughts, planned steps, and executed actions.
- 💾 **Uncommitted Work Salvage**: Scans your main repository and any isolated subagent worktrees (`.claude/worktrees/*`), capturing uncommitted diffs and untracked files.
- 🤖 **In-Flight Subagents**: Identifies subagent rollouts, their progress, and their worktree paths.
- 📋 **Structured Tasks & Checkpoints**: Extracts task checklists and completion statuses.
- 🚀 **Zero-Context-Waste Handoff Brief**: Synthesizes a high-density resume prompt that lets Pi continue immediately with zero wasted tokens.

---

## 📦 Installation

### As a Pi package (recommended):

```bash
# Global install (all projects)
pi install npm:pi-tagteam

# Or install from GitHub
pi install git:github.com/bharath31/pi-tagteam
```

### Try it without installing:

```bash
pi -e npm:pi-tagteam
```

### Local development:

```bash
git clone https://github.com/bharath31/pi-tagteam.git
cd pi-tagteam
npm install
npm run build
pi -e ./dist/index.js
```

---

## 🎮 Usage

### 1. Interactive Handoff Menu: `/tagteam`

Run `/tagteam` inside Pi in your project directory:

```bash
/tagteam
```

You'll see an interactive selector listing recent Claude Code and Codex sessions:

```
[Claude] 2ff0508d · 12m ago · "Review security vulnerabilities..." (main)
[Codex]  019f285f · 1h ago · "Install Auth0 plugin" (feature/auth)
```

Select a session to choose how to continue:
- 🚀 **Tag In (Continue in current session)**: Sends the structured handoff brief directly to Pi and begins work immediately.
- 🆕 **New Session with Handoff Brief**: Creates a clean, dedicated Pi session seeded with the handoff brief.
- ✏️ **Edit Handoff Prompt**: Opens Pi's interactive editor to customize the prompt before running.
- 📋 **Preview Handoff Brief in Widget**: Pins the structured markdown brief in Pi's UI for reference.

---

### 2. Slash Commands & Shortcuts

| Command | Description |
|---|---|
| `/tagteam` | Open interactive session picker for current project |
| `/tagteam latest` | Instantly hand off the most recent session without prompting |
| `/tagteam claude` | Filter to Claude Code sessions |
| `/tagteam codex` | Filter to OpenAI Codex sessions |
| `/tagteam --all` | Search across all projects on your machine |
| `/tagteam 12` | Scan for sessions within the last 12 hours |
| `/tagteam <sessionId>` | Target a specific session ID or filename directly |
| `/handoff` / `/relay` | Aliases for `/tagteam` |
| `/claude` | Shortcut for `/tagteam claude` |
| `/codex` | Shortcut for `/tagteam codex` |

---

### 3. LLM-Callable Tool: `tagteam_handoff`

Pi's LLM can also invoke the handoff tool autonomously! If you type:

> *"Hey Pi, I was working on PR #45 in Claude Code earlier and hit my rate limit. Can you take over?"*

Pi will call `tagteam_handoff`, discover the session, inspect the uncommitted worktrees, and continue without you having to run any commands.

#### Tool Parameters:
- `tool`: `"claude"` | `"codex"` | `"both"` (default: `"both"`)
- `maxAgeHours`: number (default: `48`)
- `allProjects`: boolean (default: `false`)
- `sessionId`: string (optional exact match)
- `format`: `"brief"` | `"full"` | `"summary"` (default: `"brief"`)

---

### 4. Smart Startup Detection

When Pi starts in a workspace where an interrupted Claude Code or Codex session occurred within the last 2 hours, `pi-tagteam` shows a gentle reminder:

```
💡 Recent Claude Code session detected (15m ago: "Review security vulnerabilities..."). Run /tagteam to take over.
```

---

## 🔍 Supported Agents & Data Sources

### Claude Code (`~/.claude/`)
- **Transcripts:** `~/.claude/projects/<encoded-path>/<session-id>.jsonl`
- **Subagents:** `~/.claude/projects/<encoded-path>/<session-id>/subagents/*.meta.json` & `.jsonl`
- **Tasks & Todos:** `~/.claude/tasks/<session-id>/*.json`
- **Worktrees:** `<project>/.claude/worktrees/*`
- **Global History:** `~/.claude/history.jsonl`

### OpenAI Codex (`~/.codex/`)
- **Rollout Sessions:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- **Archived Sessions:** `~/.codex/archived_sessions/rollout-*.jsonl`
- **Thread Index:** `~/.codex/session_index.jsonl`
- **Rate Limits & Token Usage:** Extracts quota percentages, reset timestamps, and token counts.

---

## 🛠️ Development & Testing

```bash
# Run unit & discovery tests
npm test

# Build TypeScript to dist/
npm run build

# Watch mode
npm run watch
```

---

## 📄 License

[MIT](LICENSE) © Bharath
