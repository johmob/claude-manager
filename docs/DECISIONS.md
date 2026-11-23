# Decisions and verification log

Choices for every item the spec marks **Open**, plus what was verified against the real Claude Agent SDK.

## Tech stack: Electron + TypeScript + React

| Need | Why Electron fits |
|---|---|
| Structured, labelled events (spec §2) | The official Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) is TypeScript. It runs in Electron's main process and hands us typed messages: thinking, text, tool calls, questions, permission requests. No hand-written JSON-stream parser. |
| Always-on-top, never steal focus (dock, overlay) | `BrowserWindow` options `alwaysOnTop`, `focusable: false`, `showInactive()`. |
| Click-through overlay unless a modifier is held | `setIgnoreMouseEvents(true, { forward: true })`; the renderer sees forwarded mouse moves with `ctrlKey` and switches click-through off while Ctrl is held. |
| Taskbar flashing, Windows notifications, tray | `flashFrame`, `Notification`, `Tray` are built in. |

C#/WPF was the alternative. It gives a more native app but would need its own stream-json parser and protocol handling for the Claude Code CLI, which the SDK already provides and keeps up to date.

Versions: Electron 45, electron-vite 6, Vite 8, React 19, TypeScript 6 (TypeScript 7, the new Go compiler, is too fresh to rely on).

UI language: Swedish (matches the user's other tools).

## Architecture

- **Main process** owns all state. Modules live in `src/main/modules/<name>/` and never import each other.
- **Composition root** `src/main/index.ts` is the only place that wires modules together, by passing callbacks and data.
- **Shared vocabulary** `src/shared/` holds `contracts.ts` (types and a few constants) and `guards.ts` (pure type guards for untrusted JSON). It contains no behaviour, so importing from it is the one allowed cross-module import; it is how modules avoid both duplicated helpers and dependencies on each other.
- **Renderers are views.** They receive `SessionSummary[]`, transcripts, and usage snapshots over IPC and send user intents back. One renderer bundle serves three windows via the URL hash: `#main`, `#dock`, `#overlay`.

## SDK verification (2026-11-23, SDK 0.3.330 / Claude Code 2.1.330)

Run `node tools/verify-sdk.mjs <workDir> <logFile>` to repeat. Results:

| Feature | Works in SDK mode | How |
|---|---|---|
| Streaming input (multi-turn session) | Yes | `query({ prompt: AsyncIterable<SDKUserMessage> })` |
| Questions (AskUserQuestion) | Yes | Arrives in `canUseTool('AskUserQuestion', input)`. Answer with `{ behavior: 'allow', updatedInput: { ...input, answers: { [question]: label } } }`. |
| Permission requests | Yes | `canUseTool(toolName, input)` with `permissionMode: 'default'` or `'auto'` (auto asks only when its classifier cannot decide). `title`/`description` were empty for Bash, so the app builds its own summary from the input. |
| Thinking | Yes | `thinking: { type: 'adaptive', display: 'summarized' }` gives readable `thinking` blocks; hidden behind a "+" in the UI. |
| `/compact` | Yes | Sent as a normal prompt; emits `system/compact_boundary`. |
| `/clear` | Yes | Emits `conversation_reset` (trigger `clear`). |
| `/context` | Yes | Returns markdown as the turn result. The app instead calls `query.getContextUsage()` for a structured percentage. |
| Switch model | Yes | `query.setModel(alias)`. `supportedModels()` lists the aliases `default`, `opus`, `fable`, `sonnet`, `haiku`. |
| Slash command list | Yes | `system/init.slash_commands` and `query.supportedCommands()`. |
| Subagents | Yes (typed) | `system/task_started` (`task_type: 'local_agent'`) and `system/task_notification`. |
| Rate limits in stream | Yes | `rate_limit_event` carries `unifiedWindows.five_hour/seven_day` (utilization 0–1). Used as a live supplement to the OAuth poll. |
| `TodoWrite` | **No** | Not in the SDK session's tool list. Irrelevant: the todo tree is a file the agent writes (see below). |
| `session_state_changed` | **Not emitted** | Status is derived from turn start/result and pending input instead. |
| "You Should Know" plugin | **Not found** | Not installed, not in the official marketplace (`claude-plugins-official`), and `claude plugin details you-should-know` finds nothing. Highlights are left out of v1. If the plugin turns up, its notes would arrive as `system/informational` or `system/notification` messages, which the engine already labels. |

## Usage panel

Ported from `johmob/claude-usage-trafficmonitor`:
`GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <claudeAiOauth.accessToken>` from `%USERPROFILE%\.claude\.credentials.json` (or `%CLAUDE_CONFIG_DIR%`) and header `anthropic-beta: oauth-2025-04-20`. Fields `five_hour` / `seven_day` → `utilization` (percent) and `resets_at`. Poll every 180 s. Never refresh the token (that could log Claude Code out). Thresholds same as the plugin: orange from 70 % used, red from 90 % used.

## Todo tree file

Path: `<project>/.claude-manager/todo.json`. Only the main agent writes it; the format is given to every session in the appended system prompt.

```json
{
  "title": "What this session is building",
  "updated": "2026-11-23T09:00:00Z",
  "blocks": [
    { "id": "1", "title": "Main block", "status": "in_progress",
      "steps": [ { "id": "1.1", "title": "Sub-step", "status": "done" } ] }
  ]
}
```

`status` is `not_started`, `in_progress` or `done`. The card's "current task" is the first `in_progress` step (falling back to the latest tool activity).

## Other open items

| Item | Decision |
|---|---|
| Session statuses | `starting`, `working`, `waiting` (question or permission), `done` (turn finished, not yet seen), `idle`, `error`, `stopped` (resumable after restart). |
| Do-not-disturb | Toggle. Suppresses Windows notifications and taskbar flashing; cards, dock and overlay still turn red. |
| Alert on finished turn | Setting, off by default. A finished turn always shows as `done` on the card. |
| Model per session | Chosen at start (`default`, `opus`, `sonnet`, `haiku`, `fable`); switchable later from the tile menu. |
| Permission mode per session | Chosen at start; default `auto` (classifier approves, asks only when unsure). |
| New chat folder | `%APPDATA%\claude-manager\chats\<id>` so chats never touch a code project. |
| Existing project | A short Haiku query, limited to read-only tools in `C:\Kod`, returns the matching folder; the user confirms before the session starts there. |
| Base CLAUDE.md | Stored in `%APPDATA%\claude-manager\base-CLAUDE.md`, appended to the Claude Code system prompt (the project's own CLAUDE.md still loads). |
| Dock click | Brings the main window forward with that session opened. |
| Error states | SDK errors and process exits mark the card `error` with the message; the card offers Resume. Usage-limit errors come through as `rate_limit_event` with `status: 'rejected'` and are shown on the card. |
| Transcript logging and search | Claude Code already saves every transcript (`~/.claude/projects`); resume uses it. Full-text search is left for a later version. |
| Token storage | The app stores no tokens. It only reads Claude Code's own credentials file, the same way the taskbar plugin does. |
