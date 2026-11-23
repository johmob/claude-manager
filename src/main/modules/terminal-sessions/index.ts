// terminal-sessions: Claude Code sessions started outside the app (terminal windows). Reads Claude
// Code's saved sessions and its registry of running interactive processes, so a session can be
// imported with its whole conversation and is never resumed while a terminal still holds it.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { ImportCandidate, TerminalStatus } from '../../../shared/contracts';
import { isRecord } from '../../../shared/guards';

export interface LiveTerminal {
  sessionId: string;
  pid: number;
  status: TerminalStatus;
  name: string;
  cwd: string;
}

const STATUSES: readonly TerminalStatus[] = ['busy', 'idle', 'waiting'];
const TITLE_LENGTH = 60;

/** Interactive Claude Code processes running now, from `<configDir>/sessions/<pid>.json`. */
export function liveTerminals(configDir: string): LiveTerminal[] {
  const dir = join(configDir, 'sessions');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    return [];
  }
  return files.flatMap((f) => {
    const entry = readEntry(join(dir, f));
    return entry && isAlive(entry.pid) ? [entry] : [];
  });
}

/**
 * Saved interactive sessions (the same list as `/resume` in a terminal; the app's own SDK sessions are
 * left out), newest first, with the terminal that still runs each one. Skips sessions in `exclude`.
 */
export async function importCandidates(configDir: string, exclude: ReadonlySet<string>, limit = 40): Promise<ImportCandidate[]> {
  const live = new Map(liveTerminals(configDir).map((t) => [t.sessionId, t]));
  const saved = await listSessions({ limit, includeProgrammatic: false });
  return saved.flatMap((s): ImportCandidate[] => {
    const terminal = live.get(s.sessionId);
    const cwd = s.cwd ?? terminal?.cwd ?? '';
    if (!cwd || exclude.has(s.sessionId) || s.archived) return [];
    const title = terminal?.name || s.customTitle || s.summary || s.firstPrompt || basename(cwd);
    return [
      {
        claudeSessionId: s.sessionId,
        cwd,
        title: title.length > TITLE_LENGTH ? `${title.slice(0, TITLE_LENGTH - 1)}…` : title,
        lastActivity: s.lastModified,
        terminal: terminal ? { pid: terminal.pid, status: terminal.status, name: terminal.name } : null,
      },
    ];
  });
}

function readEntry(path: string): LiveTerminal | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(raw) || typeof raw['pid'] !== 'number' || typeof raw['sessionId'] !== 'string') return null;
    if (raw['kind'] !== undefined && raw['kind'] !== 'interactive') return null;
    return {
      sessionId: raw['sessionId'],
      pid: raw['pid'],
      status: STATUSES.find((s) => s === raw['status']) ?? 'unknown',
      name: typeof raw['name'] === 'string' ? raw['name'] : '',
      cwd: typeof raw['cwd'] === 'string' ? raw['cwd'] : '',
    };
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
