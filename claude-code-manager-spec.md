# Claude Code Manager – Requirements Specification

A Windows desktop app that acts as a graphical front end for running and supervising many Claude Code sessions at once. This spec is for Claude Code to implement. Where something is marked **Open**, Claude Code decides and documents the choice.

> **This is a first draft, not set in stone.** Ask the user whenever something is unclear or missing (e.g. repo links, preferences). Suggestions for improvements and new ideas are actively encouraged. Propose them before or during implementation.

## 1. Goals

- Run and monitor multiple Claude Code sessions from one app, without seeing raw terminal windows.
- Show only what matters: answers, questions and progress. Hide thinking by default.
- Never miss a question from a session (top priority).
- Stay out of the way while the user works in other programs (e.g. SolidWorks).

## 2. Architecture principles (also apply to the app itself)

- Build everything as self-contained modules with clearly defined inputs and outputs.
- No duplicated functions across modules. No module may require another module.
- No quick fixes. Clean, minimal functions.
- Drive Claude Code through its structured interface (headless mode with structured/stream JSON output, or the Claude Agent SDK), **not** by scraping a terminal. Thinking, tool calls, answers, questions and permission requests must be read as separate, labelled events.
- **Open:** tech stack (e.g. C#/WPF, WinUI, Electron). Choose and justify.
- **Verify early:** whether all needed slash commands and interactive features work in structured/SDK mode. Document any gaps.

## 3. Output handling

- Version 1 uses structured output only. No extra LLM filter agent.
- Thinking is hidden by default, collapsed behind a small expand control (e.g. a plus sign) per message.
- **Optional feature:** the official built-in Claude Code plugin **You Should Know** (a side agent that flags important information). Verify whether its notes appear in the structured output stream. If they do, show them as highlights on the session card and in the session view. If not, document this; a future version may add a small stateless Haiku pass instead.
- Any future LLM processing must be stateless per call (no accumulating context).

## 4. Main views

### 4.1 Overview (default view)

- A grid of cards, one per session.
- Each card shows: session name, its assigned colour, current status (working / idle / waiting for input / done / error), current task, and a row of small dots showing how many agents/subagents are active.
- Styling is open, but it must look clean and polished.
- Clicking a card opens its todo tree (see section 7).
- When a session has a question, its card expands to show the question, and the user can type the answer directly in the card.
- Permission requests are shown the same way, with Approve / Deny.

### 4.2 Focus mode (tiled sessions)

- Select sessions with checkboxes to show their live output side by side.
- Up to six sessions, automatically sized into a grid based on how many are selected.
- Each tile has a clear name header in the session's colour.
- The layout can snap to half the screen or the full screen.
- Each tile has an input box, plus buttons or a small menu for common slash commands (compact, clear, switch model, check context), and a way to type any other slash command.

### 4.3 Dock mode

- A compact, always-on-top strip of cards, snappable to the right edge, bottom, or centre of the screen.
- Works like the macOS dock: when a session has a question, its card bounces and flashes red.
- Click behaviour (e.g. opening the session in the main window) is open.

### 4.4 Mini overlay

- Tiny always-on-top icons, one per session, each with a short name, placed top centre by default.
- Spinner or orange while working, calm colour when idle, red flashing when a question is waiting.
- Must never steal focus. Clicks pass through unless a modifier key is held.

### 4.5 Session colours

- Each session is assigned its own pleasant, distinct colour, used consistently in cards, tiles, dock and overlay.

## 5. Alerts (top priority)

- When any session asks a question or needs permission: Windows notification, taskbar flashing, card expands (overview), card bounces red (dock), icon flashes red (overlay).
- **Open:** a do-not-disturb mode, and whether finished tasks also trigger an alert.

## 6. Usage panel

- Next to the cards, two clear bars:
  - Top: tokens remaining in the current five-hour window, plus reset time.
  - Bottom: tokens remaining for the week, plus reset time.
- Bars turn orange, then red, as usage runs low (thresholds open).
- Reuse the existing usage readout from the user's taskbar tool, which reads the data via OAuth. The repo is not given here: ask the user for it.

## 7. Todo tree and progress

- Every agent keeps a structured todo tree file in its project (format open, e.g. JSON), with numbered main blocks and sub-steps under each.
- Each item has a status: not started, in progress, done (green).
- Clicking a card shows the tree with live status.
- Only the main agent writes to the file. Subagents report to the main agent.
- No time-remaining estimate in version 1. Show progress from the tree, elapsed time and current activity instead.

## 8. Starting sessions

Three buttons:

- **New chat:** a plain conversation, not tied to a code project.
- **New project:** starts in the user's `kod` folder, asks for a name, creates the folder and launches there. Checkbox: **Create Git repo**. If ticked, the agent's first task (added to its instructions) is to initialise a local Git repository and create a matching **private** repo on the user's GitHub.
- **Existing project:** the user describes in plain words which project it's about; the agent finds the folder under `kod`.
- **Open:** model choice per session at start.

## 9. Session lifecycle

- Closing the app while sessions run: warn and offer to stop them or minimise to the system tray (they keep running).
- On restart: reopen previous sessions as cards, resumable with one click using Claude Code's saved session IDs.
- Each card has an explicit close action that archives the session.
- **Open:** error states (crash, usage limit, network loss), full transcript logging and search, secure token storage (e.g. Windows Credential Manager).

## 10. Shared base CLAUDE.md

- The app keeps one base CLAUDE.md that every session starts with. It is added to each project's own CLAUDE.md, not a replacement.
- An **Edit ground rules** button starts a dedicated agent whose only job is to add the user's instructions to the base CLAUDE.md.

Default ground rules:

1. Answer and ask questions concisely.
2. Work in parallel with subagents where it makes sense. Set each subagent's model and effort level to suit the task.
3. Use Fable (the top model) only for large planning jobs. Hand execution to cheaper, lighter models.
4. Before starting, write a todo tree: numbered main blocks with sub-steps. Keep it updated continuously. When the plan changes, update the tree before changing direction. Only the main agent writes to it.
5. Build everything as self-contained modules with clearly defined inputs and outputs. No duplicated functions across modules, and no module may depend on another. No quick fixes; clean, minimal functions.
