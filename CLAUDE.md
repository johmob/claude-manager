# Claude Manager: notes for agents working on this repo

A Windows app (Electron, TypeScript, React, Claude Agent SDK) that runs and supervises many Claude Code sessions. Read `README.md` for what it does and `docs/DECISIONS.md` for why it works the way it does.

## Code
- Modules in `src/main/modules/<name>` never import each other. `src/main/index.ts` is the composition root that wires them. Shared types and constants live in `src/shared/contracts.ts`. The renderer (`src/renderer`) is views only and talks to main through the typed IPC in `window.cm`.
- Checks: `npm run typecheck` and `npm test`.
- Try UI changes in a test instance with its own data folder, so the user's installed app is never touched: set `CLAUDE_MANAGER_DATA_DIR` to a scratch folder, run `npx electron-vite build` and `npx electron . --remote-debugging-port=9334`, then drive it with `tools/cdp.mjs`.

## The repo is public
Never commit personal or company data: names, e-mail addresses, user paths, customer or project details, credentials. Test data stays generic.

## Shipping a new version
Installed apps update themselves from this repo's GitHub releases. They download in the background and install once no session is working or waiting for the user.
1. Commit and push the change to `main`.
2. Run `npm run release` (`-- minor` for a minor version). It runs the checks, bumps the version, tags `vX.Y.Z`, pushes, builds the installer and publishes it as a GitHub release with the GitHub CLI (`tools/release.mjs`), then checks that the installer, blockmap and `latest.yml` are all on the release, and nudges the running app on this computer to look for it at once (it installs when no session is busy).

Do not build or reinstall the user's installed app yourself unless they ask. They run many agents in it.
