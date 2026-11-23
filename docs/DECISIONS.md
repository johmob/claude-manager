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
| "You Should Know" plugin | **Loads, but notes do not reach the stream** | It is built into Claude Code as `cc-plugin-you-should-know` (off by default, so no plugin list shows it). An SDK session can enable it with `settings: { enabledPlugins: { 'cc-plugin-you-should-know@builtin': true } }` and `system/init.plugins` then lists it. Its notes are drawn by the terminal UI ("above the prompt", via the plugin `ui.render` surface); the public SDK has no message or callback for that surface. Two test runs (`tools/verify-ysk.mjs`: Haiku with 5 tool calls, then Sonnet with 12 tool calls and the session held open 90 s) produced no note in the stream, and the plugin never wrote its state file (`~/.claude/plugins/store/`), so it does not activate in SDK sessions. Replaced by callouts the agent tags itself (below), with the user's approval. |

## Usage panel

Ported from `johmob/claude-usage-trafficmonitor`:
`GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <claudeAiOauth.accessToken>` from `%USERPROFILE%\.claude\.credentials.json` (or `%CLAUDE_CONFIG_DIR%`) and header `anthropic-beta: oauth-2025-04-20`. Fields `five_hour` / `seven_day` → `utilization` (percent) and `resets_at`. Poll every 180 s. Never refresh the token (that could log Claude Code out). Thresholds same as the plugin: orange from 70 % used, red from 90 % used.

## Callouts: the agent tags what matters (replacement for the You Should Know plugin)

Every session's system prompt includes `CALLOUT_PROTOCOL` (in session-engine). It asks the agent to end a message with GitHub alert blocks when something deserves attention:

| Marker | Shown as | Used for |
|---|---|---|
| `> [!CAUTION]` | **Risk**, red, larger title | risky, destructive or irreversible actions; secrets and security |
| `> [!WARNING]` | **Varning**, amber | something failed, was skipped or did not work |
| `> [!IMPORTANT]` | **Bra att veta**, purple | easy to miss |
| `> [!NOTE]` | **Antagande**, blue | an assumption made on the user's behalf |
| `> [!TIP]` | **Förslag**, green, subdued | a suggested next step (transcript only, not on the card) |

The format is plain markdown, so it also reads well in a terminal. session-engine splits each text block into a `text` event and labelled `callout` events, ignoring code fences. Saved history goes through the same path. The card shows the latest turn's callouts, most severe first, until dismissed (×) or the next turn starts. The dock shows the icon of the most severe one, and the transcript shows each one where it was written.

Why the working agent tags its own callouts: it costs nothing extra, it knows its own assumptions and skipped steps, and the tag stays in the answer. Tested before building (Haiku and Sonnet, 4 scenarios each): a glossed-over failure, a missing file, routine success and a logged password were tagged WARNING, WARNING/NOTE, nothing and CAUTION respectively, 8 out of 8 correct. The weakness is self-assessment: in long runs the agent cannot flag what it does not notice.

**Granskning (optional, off by default).** For that weakness, module `turn-review` can send one stateless Haiku request after each turn with at least 3 tool calls (`structured-query`, no tools, `persistSession: false`, nothing accumulated, as spec §3 requires). The request holds a log of only that turn, capped at 8,000 characters, including the callouts the agent already gave. It returns at most one extra callout, marked "granskning". Verified: a turn that only did what was asked gave nothing; a turn answering "Done" over a failed command gave a correct warning. The toggle is **Granskning** in the top bar.

`structured-query` is also what the project locator uses. The root passes the function into both modules, so neither imports the other.

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
| Importing terminal sessions | `terminal-sessions` lists saved sessions with the SDK's `listSessions({ includeProgrammatic: false })` (the terminal `/resume` list, so the app's own SDK sessions are left out) and reads Claude Code's registry of running interactive processes, `<config>/sessions/<pid>.json` (`sessionId`, `cwd`, `name`, `status` busy/idle/waiting; liveness checked with the pid). An import creates a stopped card with the saved history. The app refuses to resume a session while its terminal process is alive, because two processes appending to one transcript would fork it; the card explains to close the window first. Closing a terminal mid-turn interrupts that turn (everything before it is saved), so the advice is to wait until the agent is idle. |
| Transcript after restart | Loaded from Claude Code's saved transcript with the SDK's `getSessionMessages` (local files, no tokens) and replayed through the same event pipeline as live output, so it looks identical. After a `/compact` only the active part exists; the compacted part shows as one notice. Pending questions from before the restart are not restored: the agent is asked again on resume. |
| Token storage | The app stores no tokens. It only reads Claude Code's own credentials file, the same way the taskbar plugin does. |
