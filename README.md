# Claude Manager

A Windows app for running and supervising many Claude Code sessions at once, without terminal windows. Questions and permission requests from any session show up straight away: the card expands, a Windows notification appears, the taskbar flashes, and the dock and overlay turn red.

The requirements are in [claude-code-manager-spec.md](claude-code-manager-spec.md). Decisions and SDK verification results are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Install

1. Download `Claude Manager Setup x.y.z.exe` from the latest [release](https://github.com/johmob/claude-manager/releases/latest) and run it. The installer is not signed, so Windows SmartScreen may warn: choose *More info* → *Run anyway*.
2. The app uses your Claude subscription through Claude Code's login. If you have not used Claude Code on this computer, install it and run `claude` once in a terminal to log in.
3. On first start, choose the folder where your projects live. You can change it later under *Nytt projekt* or *Befintligt projekt*.

The app updates itself. It checks this repo's releases, downloads a new version in the background and installs it once no session is working or waiting for you. Turn this off with **Auto-uppdatera** in the top bar, or click **Installera nu** to install at once.

## Releasing

Commit and push, then run `npm run release` (`npm run release -- minor` for a minor version). It runs the checks, bumps the version, tags it, pushes, builds the installer and publishes it as a GitHub release with the GitHub CLI's login. Installed apps pick it up.

## Build from source

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
| **Ny chatt** | A small window for quick questions, like a web search: answers in Swedish, searches the web when needed, follow-ups continue, "Ny fråga" starts over. Never a card. Also always in the overlay: click to fold it out, double-click for a large window. |
| **Nytt projekt** | Creates `<projects folder>\<name>` and starts there. **Skapa Git-repo** makes the agent's first task a local repo plus a private GitHub repo (`gh`). |
| **Befintligt projekt** | One place to get back to existing work. Either pick recent conversations from the list (the same list as `/resume`, including ones still open in a terminal) and open them as cards, or describe the project: Haiku finds the folder under `C:Kod`, and its latest conversation is preselected to continue, with "Nytt samtal i mappen" as the alternative. If the folder already has a card, you can open that instead. A conversation still running in a terminal opens with its history but continues only after the terminal window is closed. |
| **Grundregler** | Starts an agent whose only job is to merge your instructions into the base CLAUDE.md that every session gets. |
| **Översikt** | One card per session: status, model and effort (change them right on the card; only models your account has are offered), current task, agent dots, overall progress. A context meter shows how full the conversation is and the tokens used so far, lets you set the window size (when the conversation is compacted automatically) and has a Komprimera button. Write to the agent in the card's message box, and answer questions or approve actions right there. Click a card for its work schema; "Öppna chatten" opens it in Fokus. With six cards or fewer they fill the window and show the latest answer. New sessions start on Opus with medium effort. |
| **Taggad text** | After each turn a cheap model (Haiku) tags every block of the agent's text: Resultat, ✓ Godkänt, ✕ Fel, Varning, Risk, Fråga, Antagande, Beslut, Förslag, or quiet narration (plan, progress, background), which is dimmed and folds away. Nothing is rewritten. |
| **Frågor** | Questions and assumptions an agent ends a turn with make the session wait and blink. They are the agent's own tagged blocks plus what a cheap model (Haiku) reads out of the turn with understanding; reports and lists are never taken for questions by rules. Answer them one at a time in a full-screen flow: from the overlay (click the session; opens over the screen without the app), when the app comes to the front, or with "Svara på N frågor" on the card. All answers go back as one message. |
| **Arbetsschema** | The button on each card (and in Fokus) leads with what remains: "12 punkter kvar", how much of the project is done and how much is in progress. In the schema, click a track or an item for its details (the agent's notes, what it waits for, what waits for it, sub-items) and write a comment about exactly that part; the reference is added for you. A track the agent marks as focused glows. "Dölj avklarade" shows only what remains. |
| **Kartlägg** | A project connected without a work schema is mapped first, by the session's own main agent so the map stays in its memory. For that turn it runs on Fable (Opus if your account lacks Fable) with high effort, then goes back to the card's model and effort; your first message is sent once the map exists. One project maps at a time. "Kartlägg om" in the schema view, optionally with your own description of the structure. |
| **Frågor** | Questions and assumptions an agent ends a turn with ("Antaganden, rätta om fel", "Öppna frågor", lines ending in "?", tagged blocks) make the session wait and blink. Answer them one at a time in a full-screen flow: from the overlay (click the session; opens over the screen without the app), when the app comes to the front, or with "Svara på N frågor" on the card. All answers go back as one message. |
| **Arbetsschema** | The session's plan as an org chart: the project on top and parallel tracks below it (for example CAD, firmware for each device, result pages), with items, owners, progress, "Pågår nu" and "Väntar" for items waiting on another item. The window widens itself when needed. Click a track or an item to write to Claude about exactly that part; the reference is added for you. Agents ask before opening a new track when the work moves into a new area. |
| **Användning** | 5-hour and weekly quota shown as "% använt", with the plan (e.g. Claude Team) under the heading: green, yellow from 50 % used, orange from 70 %, red from 90 %. |
| **Fokus** | Up to six sessions side by side, chosen automatically: a session comes in when you write to it or open it, and leaves after 3 days without work. Each tile has an input box (Enter sends, `/` for slash commands) and a menu for `/compact`, `/clear`, switching model, context usage and interrupt. Snap the window to the left half, the right half, or full screen. |
| **Docka** | Always-on-top strip at the right edge, the bottom, or the centre of the screen. A card bounces red when its session needs you. Click it to open the session. |
| **Overlay** | On by default. A strip at the top centre: usage on a dark panel, then one icon per session that spins while it works and blinks yellow and red while it waits for you, with how many of its agents work (e.g. 2/4). Hover for a compact summary. A hovered icon takes the mouse: click opens the session in the app; the hover panel has Svara, Öppna and Arbetsschema (the schema opens as a modal over the screen without bringing the app forward, live, with item details and comments). Everything else in the strip lets clicks through to the window below. |
| **Håll vaken** | The crossed-out moon next to Stör ej keeps the computer awake and unlocked (no sleep, no display off, no idle lock: it presses Shift every two minutes), so agents can work overnight. |
| **Start med Windows** | On by default (tray menu). At login the app starts in the system tray with the overlay; the tray icon opens the window. |
| **⚙ Inställningar** | Nattläge (default: deeper blacks, high contrast, glow), Auto-uppdatera, Fortsätt efter gränsen (sessions stopped by the usage limit continue once it resets), dock position, version. |
| **Textstorlek** | Ctrl + plus/minus in the window (Ctrl + 0 resets); remembered. Text uses Inter, bundled with the app. |
| **Stör ej** | No notifications or taskbar flashing; cards, dock and overlay still turn red. |
| **Callouts** | Agents tag what matters with markdown alerts: **Risk** (red), **Varning** (amber), **Bra att veta** (purple), **Antagande** (blue), **Förslag** (green). The card shows the latest turn's tags until you dismiss them (×), the dock shows the most severe icon, and the transcript shows each one in place. |

Closing the window while sessions run asks whether to minimise to the tray (sessions keep running) or stop them. After a restart every session comes back as a card; send a message or press ▶ to resume it with its full history.

## Layout

```
src/shared/          contracts.ts (types + constants), guards.ts (JSON type guards)
src/main/index.ts    composition root: wires modules, persistence, IPC
src/main/modules/    self-contained modules; none imports another
  session-engine     Agent SDK wrapper -> labelled SessionEvents (incl. callout tags)
  session-model      events -> cards (SessionSummary) and transcripts
  usage-monitor      5-hour / weekly usage via Claude Code's OAuth token
  todo-tree          .claude-manager/todo.json format, mapping request, parser, watcher
  terminal-sessions  sessions started in terminals: import list and live-process guard
  focus-rules        which sessions are in Fokus
  account            plan and models the account may use
  structured-query   one-shot Claude call returning schema-checked JSON (injected by the root)
  json-store, palette, ground-rules, projects, notifier, window-manager, tray
src/preload/         typed IPC bridge (window.cm)
src/renderer/        React UI for the main window, dock and overlay (#main, #dock, #overlay)
tools/               SDK verification, CDP driver, icon generator
```

## License

MIT, see [LICENSE](LICENSE).
