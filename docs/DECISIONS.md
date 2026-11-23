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

Ported from a TrafficMonitor taskbar plugin that reads the same data:
`GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <claudeAiOauth.accessToken>` from `%USERPROFILE%\.claude\.credentials.json` (or `%CLAUDE_CONFIG_DIR%`) and header `anthropic-beta: oauth-2025-04-20`. Fields `five_hour` / `seven_day` → `utilization` (percent) and `resets_at`. Poll every 180 s. Never refresh the token (that could log Claude Code out). Levels: green below 50 % used, yellow from 50 %, orange from 70 %, red from 90 % (the red bar pulses).

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

**No second-opinion model.** An optional Haiku review of each turn existed briefly and was removed: judging what matters is the main agent's job (the user: a small model mapping the project or summarising what is important is dangerous). The main agent's own tags are the only source.

`structured-query` is also what the project locator uses. The root passes the function into both modules, so neither imports the other.

## Work schema (the todo tree file)

Path: `<project>/.claude-manager/todo.json`. The main agent writes it, following `TODO_PROTOCOL` in the todo-tree module, which is appended to every session. The user asked for the plan to read like an org chart. The project sits on top, **parallel tracks** sit under it (CAD, firmware for each device, result pages …), and items and sub-items sit under each track.

```json
{
  "title": "What this session is building",
  "updated": "2026-11-23T09:00:00Z",
  "tracks": [
    { "id": "fw-a", "title": "Firmware – controller", "owner": "firmware-a", "items": [
      { "id": "fw-a.1", "title": "SPI driver", "status": "done" },
      { "id": "fw-a.2", "title": "Data protocol", "status": "in_progress", "progress": 40 } ] },
    { "id": "web", "title": "Web – result pages", "owner": "main", "items": [
      { "id": "web.1", "title": "Live chart", "status": "not_started", "dependsOn": ["fw-a.2"] } ] }
  ]
}
```

- **Status and progress.** The agent sets `status` only on the lowest-level items, plus `progress` (0–100) while an item is in progress. The parser computes each parent and track from its items, so they never contradict each other. It also computes the overall progress. Done always counts as 100 and not started as 0. An item in progress without a `progress` value counts as 50.
- **Dependencies.** An item is marked **blocked** while any item it lists in `dependsOn` is unfinished. This works across tracks.
- **Owners.** `owner` names the subagent responsible for a track, or "main". The ground rules ask for one subagent per track where that makes sense.
- **New tracks.** When the work reaches a new area or phase that no track covers, the agent asks (AskUserQuestion) whether to open a new track before starting on it, proposing a title and an owner. Verified: given "Vi behöver också en mobilapp…", Sonnet asked exactly that and offered "under the web track" as the alternative.
- **Older format.** The earlier `blocks`/`steps` format still parses; blocks become tracks.
- **Arbetsschema view.** It opens from the card button, a card click or the tile header. It shows the org chart with progress for every track and item, "Pågår nu", "Väntar" with the items being waited for, and owners. If the tracks do not fit side by side, the window is maximised while the view is open and restored afterwards. The tracks then share the width, and titles wrap.
- **Ask about a part.** Clicking a track or an item opens a message box. The app adds the reference automatically before sending the message to the session's Claude, for example `Angående punkt fw-s.2 "…" i arbetsschemat (spår fw-s "…", ansvarig …):`. The session then opens in Fokus.
- **Current task on the card.** The card shows the first in-progress item of each track, for example "fw-s.1 SPI-drivrutin (+1 parallellt)".

## Other open items

| Item | Decision |
|---|---|
| Session statuses | `starting`, `working`, `waiting` (question or permission), `done` (turn finished, not yet seen), `idle`, `error`, `stopped` (resumable after restart). |
| Do-not-disturb | Toggle. Suppresses Windows notifications and taskbar flashing; cards, dock and overlay still turn red. |
| Alert on finished turn | Setting, off by default. A finished turn always shows as `done` on the card. |
| Model and effort per session | Chosen at start and changeable on every card and tile header. A change applies to a running session at once: `query.setModel()` for the model, `query.applyFlagSettings({ effortLevel })` for effort (`null` returns to the model's default). Both are saved with the card. |
| No dollar cost | The user's plan is not billed per dollar, so the app shows no cost. Each card shows tokens used instead (input, output and cache tokens of every turn, added up and saved with the card), and the context meter. |
| Context window | The meter shows how full the context is (`getContextUsage()`, measured when a session starts and after every turn and compaction; no tokens used). "Fönster" sets `autoCompactWindow` (auto, 200k, 400k, 600k, 1M): how large the conversation may grow before Claude Code compacts it. Claude Code reads it only at start (verified: `applyFlagSettings` leaves it unchanged), so a running session is restarted with the same conversation, after the current turn if one is in progress. "Komprimera" sends `/compact`. |
| Questions to the user | Never buried in running text: the agent uses AskUserQuestion when it needs the answer before continuing, otherwise one `> [!QUESTION]` tag per question. Question tags have their own colour, icon and a larger title, and stay on the card until the next turn. |
| Fixa | Right-click a tag (not a question) and choose "Fixa": the tag's kind, title and text go to that session's agent as the request. |
| Who maps a project | The main agent reads up on the project itself and keeps the schema current at all times (ground rule 1); mapping, summarising and judging what matters are never delegated to a subagent. A project connected without a schema is mapped first by the session's own main agent, so the map is part of its conversation and it can plan from it and refer to it. For that one turn the composition root switches the session to Fable (Opus when the account lacks Fable) with effort high, and afterwards back to the card's model and effort; the temporary choice is never saved to the card, and a model or effort the user picks meanwhile applies when the mapping ends. The user's first message waits until the mapping turn is done; mappings run one project at a time, and a turn in progress is never cut off. "Kartlägg om" in the schema view runs it again, optionally with the user's own description of the structure. (An earlier one-off planner process that wrote the schema and exited was dropped: the main agent then only knew the map second-hand.) Schemas are organised by area with depth (2-3 levels), never by phase. |
| Overlay | Usage (5h and week, same colour scale) first, then one icon per session with a status mark (spinner while working, ! waiting, ✓ done, × error) and the number of active agents. Hovering grows the overlay to show details: status, current work, agents, model and effort, context, tokens, schema progress, any waiting question. Still click-through; Ctrl+click opens. |
| Commands in Fokus | Each run of tool calls is one quiet line ("4 kommandon · Glob, Read ✓") that opens on click. |
| Top bar | No app name. Left: a start menu with icons (Ny chatt, Nytt projekt, Befintligt projekt, Grundregler). Centre: the Översikt/Fokus tabs. Right: settings. |
| Defaults for new sessions | Opus with medium effort (the user's choice); raise single sessions to high on their card. |
| What is in Fokus | Automatic, decided in the main process and saved with each card (`focus-rules`). A session enters Fokus when the user writes to it (from the card or anywhere else), creates it, or opens it (double-click, dock, notification). It leaves after 3 days without a message or finished turn (checked at start and every hour). At most 6: the longest-idle focused session leaves first. The overview cards have no Fokus checkbox; it is fully automatic. |
| Writing without Fokus | Every card has a one-line message box (the compact chat input) whenever no question is waiting; a double-click on the card opens it in Fokus, a single click opens the work schema. |
| Which models the account may use | The `account` module asks Claude Code at start-up (`accountInfo()`, `supportedModels()` on an idle query, so no tokens are used, < 1 s). The choices offered are exactly the ones Claude Code lists for the logged-in account (e.g. Fable only on Max, Ultra and business plans), labelled as Claude Code names them ("Opus 5.5", "Standard (Opus 5.5)"), and the effort levels each model supports. The plan ("Claude Team") shows in the usage panel. If the probe fails, every choice is offered. |
| One-shot Claude calls in the installed app | The project locator and the optional review spawn their own Claude process. They must get the same unpacked executable path as the sessions, or they fail at once in the installed app; the root now passes one shared executable setting to every Claude process it starts. |
| Permission mode per session | Chosen at start; default `auto` (classifier approves, asks only when unsure). |
| New chat folder | `%APPDATA%\claude-manager\chats\<id>` so chats never touch a code project. |
| Existing project | Continuing is the default, so "Befintligt projekt" and importing are one dialog (the user did not want two flows). Recent conversations can be opened straight from a list, or a short Haiku query (read-only tools in `C:Kod`) finds the folder from a description; the folder's latest saved conversation is then preselected, a new conversation is the alternative, and an existing card for the folder is offered instead of a duplicate. Cards for the same folder are named "Folder · conversation title". |
| Base CLAUDE.md | Stored in `%APPDATA%\claude-manager\base-CLAUDE.md`, appended to the Claude Code system prompt (the project's own CLAUDE.md still loads). |
| Dock click | Brings the main window forward with that session opened. |
| Error states | SDK errors and process exits mark the card `error` with the message; the card offers Resume. Usage-limit errors come through as `rate_limit_event` with `status: 'rejected'` and are shown on the card. |
| Transcript logging and search | Claude Code already saves every transcript (`~/.claude/projects`); resume uses it. Full-text search is left for a later version. |
| Importing terminal sessions | `terminal-sessions` lists saved sessions with the SDK's `listSessions({ includeProgrammatic: false })` (the terminal `/resume` list, so the app's own SDK sessions are left out) and reads Claude Code's registry of running interactive processes, `<config>/sessions/<pid>.json` (`sessionId`, `cwd`, `name`, `status` busy/idle/waiting; liveness checked with the pid). An import creates a stopped card with the saved history. The app refuses to resume a session while its terminal process is alive, because two processes appending to one transcript would fork it; the card explains to close the window first. Closing a terminal mid-turn interrupts that turn (everything before it is saved), so the advice is to wait until the agent is idle. |
| Transcript after restart | Loaded from Claude Code's saved transcript with the SDK's `getSessionMessages` (local files, no tokens) and replayed through the same event pipeline as live output, so it looks identical. After a `/compact` only the active part exists; the compacted part shows as one notice. Pending questions from before the restart are not restored: the agent is asked again on resume. |
| Token storage | The app stores no tokens. It only reads Claude Code's own credentials file, the same way the taskbar plugin does. |
| Overlay clicks | Only a hovered session icon takes the mouse (click: open the session; right-click: work schema); the rest of the strip stays click-through, so it never blocks the windows below except under the icons themselves. Ctrl still makes the whole strip clickable. |
| Work schema from the overlay | Opens in its own transparent window over the primary screen, styled as a modal, focused so Esc closes it, without showing the main window. It receives the same live state pushes as the other windows. |
| Item details | A click on a track or an item opens its details (path, status, owner, the agent's "notes", what it waits for, what waits for it, sub-items) with a comment box; the message gets the item reference automatically. The schema format has a "notes" field per item for this. The agent must write notes for every track and item when it maps the project and for every new item, and keep them current. |
| When mapping counts as done | As soon as the agent has written the schema during its mapping turn, the card and schema view stop showing "Kartlägger"; switching back to the card's model and sending a held first message still wait for the end of the turn. |
| Questions in plain text | The agents are told to ask with AskUserQuestion or [!QUESTION] blocks (CALLOUT_PROTOCOL). As a safety net, the session model also checks the main agent's final answer of each turn for lines ending in a question mark (outside code). If there are any, they are gathered in one "Frågor till dig" box on the card and in the transcript, and the session counts as waiting: the overlay blinks, the dock bounces, a notification goes out. This is a plain text rule in the app, not another model; it uses no tokens. The wait ends with the next message or when the box is dismissed. |
| The schema as the agent's memory | The schema serves the user (where the project stands) and the agent (structured work, nothing lost). Ground rule 1 and the schema protocol tell the main agent to write remarks the user makes in chat about other items into those items' notes at once, marked as from the user, to say where it put them, and to read an item's notes before starting on it. |
| Focused track | A track the user chose to focus on carries "focus": true in the schema, set by the main agent (the schema stays the agent's own file). The schema view shows it glowing with an "I fokus" badge, and the card's schema button names it. The track's details have a button that asks the agent to focus on it or end the focus. |
| Answering questions | Questions and assumptions a turn ends with become the session's open questions: tagged [!QUESTION] and [!NOTE] blocks, lines ending in "?", and items listed under headings about questions or assumptions ("Antaganden, rätta om fel"). The user answers them in a full-screen flow, one at a time in large text with its own answer box (assumptions: "Stämmer" or a correction), reviews them, and sends all answers as one message. The flow opens when the app comes to the front with questions waiting (once per set; closing puts that set off), from the card's "Svara på N frågor", and from the overlay (click), where it opens in the popup over the screen without bringing the app forward. |
| Readability | Text uses Inter (bundled via @fontsource-variable/inter, no network) with higher contrast. All font sizes are rem; the main window and popups set the root size from the textScale setting (default 110 %, Ctrl + plus/minus/0), while overlay and dock keep 16 px so their fixed layouts hold. The app has no application menu, because its default zoom shortcuts would zoom every window at once (Chromium zooms per origin). |
| Updates | electron-updater against this repo's GitHub releases (`build.publish`, provider github). The app checks 30 seconds after start and every 3 hours; `npm run release` nudges a running app on the same computer to check at once (it starts the app again with `--check-update`, which reaches the running instance), and "Sök efter uppdatering nu" in the ⚙ menu does the same by hand. It downloads in the background when auto-update is on, and installs silently with a restart once no session is working, waiting for an answer or holding open questions, and no mapping runs. "Installera nu" installs at once. Releases are built and published from the developer's machine by `npm run release` (tools/release.mjs, with the `gh` login), so no CI token or workflow permission is needed; the installer is unsigned. |
| Projects folder | Chosen by the user on first start (a welcome dialog) and changeable from the project dialogs; until chosen, ~/Kod is used. |
| Transcript shape | Rounds: each message from the user starts a framed section with everything up to the next one. Within it, the user's message, the turn's answer, callouts, questions and problems show; the agent's narration, commands and info notices fold into one "Under arbetet" line. Live entries show their time; saved history has no times. Ground rule 2 asks agents to keep the chat for answers, decisions, milestones and problems, and to record routine progress in the schema. |
| Night mode | Default theme: the same UI (Inter, same shapes and layout) with deeper blacks, brighter text and vivid accents that glow on what matters (active tab, focus, primary buttons, working and waiting cards, the turn's answer). Only colours and glow change; "standard" keeps the softer palette. Set in the settings menu (⚙). |
| One question | When a turn leaves a single question, answering it (Stämmer, Enter, skip) sends at once; the review step is only for several. |
| Usage limit | A turn refused by the usage limit (a rejected rate-limit event, or Claude Code's limit text in the result) leaves the session "limited" ("Gräns nådd", red on card, Fokus, dock and overlay; the card says when it continues) until the next turn starts. With "Fortsätt efter gränsen" (⚙, on by default) the root checks every minute and, once the reset time has passed (or the usage readout shows room when no time was given), sends "continue where you were, and restart stopped subagents" to each limited session. |
| Removing a card | "Ta bort kortet" stops the session and removes the card; the project files and Claude's saved conversation stay. Replaces archiving, which had no way back in the app. |
| One-click answers | In the question flow, "A eller B?" gets a button per option and other yes/no questions get Ja and Nej (open questions with vad/vilken/hur… get none). A question written after a statement on the same line keeps only the question; the statement becomes background. |
| Fokus tile header | The session name has its own row at the top of each tile, so it stays readable in narrow tiles; status, model, effort and schema sit below. |
