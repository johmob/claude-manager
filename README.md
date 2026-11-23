# Claude Manager

A Windows app for running and supervising many Claude Code sessions at once, without terminal windows. Questions and permission requests from any session show up straight away: the card expands, a Windows notification appears, the taskbar flashes, and the dock and overlay turn red.

The requirements are in [claude-code-manager-spec.md](claude-code-manager-spec.md). Decisions and SDK verification results are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Install

```powershell
npm install
npm run dist          # -> dist\Claude Manager Setup <version>.exe
```

Requirement: be logged in to Claude Code on this computer (`claude` → `/login`). The app uses that login for both the sessions and the usage panel.

## Develop

```powershell
npm run dev           # hot-reloading app
npm test              # unit tests (vitest)
npm run typecheck
npm run build         # production build into out/
```

To drive a running app from scripts (screenshots, clicks):
`npx electron . --remote-debugging-port=9333`, then `node tools/cdp.mjs shot main shot.png` or `node tools/cdp.mjs eval main "<js>"`.

`node tools/verify-sdk.mjs <workDir> <log.jsonl>` repeats the SDK feature check from docs/DECISIONS.md on a cheap model. Run it after upgrading `@anthropic-ai/claude-agent-sdk`.

## Using it

| Where | What |
|---|---|
| **Ny chatt** | A plain conversation in its own folder under `%APPDATA%\claude-manager\chats`. |
| **Nytt projekt** | Creates `C:\Kod\<name>` and starts there. **Skapa Git-repo** makes the agent's first task a local repo plus a private GitHub repo (`gh`). |
| **Befintligt projekt** | Describe the project in your own words; Haiku finds the folder under `C:\Kod`, you confirm. |
| **Importera** | Brings in sessions started in a terminal (the same list as `/resume`), with their whole conversation. Sessions still running in a terminal are marked; the app will not resume one until its terminal window is closed, so two processes never write the same conversation. |
| **Grundregler** | Starts an agent whose only job is to merge your instructions into the base CLAUDE.md that every session gets. |
| **Översikt** | One card per session: status, current task, agent dots, todo progress. Click a card for its todo tree. Answer questions and approve or deny actions directly in the card. |
| **Fokus** | Tick up to six cards to see their live output side by side. Each tile has an input box (Enter sends, `/` for slash commands) and a menu for `/compact`, `/clear`, switching model, context usage and interrupt. Snap the window to the left half, the right half, or full screen. |
| **Docka** | Always-on-top strip at the right edge, the bottom, or the centre of the screen. A card bounces red when its session needs you. Click it to open the session. |
| **Overlay** | Tiny icons at the top centre. Clicks pass through to the window below; hold **Ctrl** to click an icon. |
| **Stör ej** | No notifications or taskbar flashing; cards, dock and overlay still turn red. |
| **Callouts** | Agents tag what matters with markdown alerts: **Risk** (red), **Varning** (amber), **Bra att veta** (purple), **Antagande** (blue), **Förslag** (green). The card shows the latest turn's tags until you dismiss them (×), the dock shows the most severe icon, and the transcript shows each one in place. |
| **Granskning** | Optional, off by default: after a turn with real work, a small independent Haiku review adds one tag the agent itself missed. It costs a little quota. |

Closing the window while sessions run asks whether to minimise to the tray (sessions keep running) or stop them. After a restart every session comes back as a card; send a message or press ▶ to resume it with its full history.

## Layout

```
src/shared/          contracts.ts (types + constants), guards.ts (JSON type guards)
src/main/index.ts    composition root: wires modules, persistence, IPC
src/main/modules/    self-contained modules; none imports another
  session-engine     Agent SDK wrapper -> labelled SessionEvents (incl. callout tags)
  session-model      events -> cards (SessionSummary) and transcripts
  usage-monitor      5-hour / weekly usage via Claude Code's OAuth token
  todo-tree          .claude-manager/todo.json format, parser, watcher
  turn-review        optional stateless Haiku review of a finished turn
  terminal-sessions  sessions started in terminals: import list and live-process guard
  structured-query   one-shot Claude call returning schema-checked JSON (injected by the root)
  json-store, palette, ground-rules, projects, notifier, window-manager, tray
src/preload/         typed IPC bridge (window.cm)
src/renderer/        React UI for the main window, dock and overlay (#main, #dock, #overlay)
tools/               SDK verification, CDP driver, icon generator
```
