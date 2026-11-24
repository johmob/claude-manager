// app-log: a local diary of what the app receives and how it shows it, to analyse problems afterwards. One
// JSON line per record in logs/app-YYYY-MM-DD.jsonl in the app's data folder; files older than two weeks are
// removed. Long texts are cut. It can be switched off in the settings; nothing leaves the computer.
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const KEEP_DAYS = 14;
const MAX_TEXT = 4000;

export interface AppLog {
  readonly dir: string;
  write(kind: string, data: Record<string, unknown>): void;
  setEnabled(on: boolean): void;
}

/** Long strings anywhere in the record are cut, so a line stays readable. */
function trim(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}… [${value.length} tecken]` : value;
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => trim(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trim(v, depth + 1)]));
}

const day = (at: Date): string => at.toISOString().slice(0, 10);

export function createAppLog(dir: string, enabled: boolean, now: () => Date = () => new Date()): AppLog {
  let on = enabled;
  try {
    mkdirSync(dir, { recursive: true });
    const oldest = day(new Date(now().getTime() - KEEP_DAYS * 86_400_000));
    for (const name of readdirSync(dir)) {
      const date = /^app-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name)?.[1];
      if (date && date < oldest) rmSync(join(dir, name), { force: true });
    }
  } catch {
    // No folder: the log simply stays off until it can be written.
  }
  return {
    dir,
    write(kind, data) {
      if (!on) return;
      const at = now();
      try {
        appendFileSync(join(dir, `app-${day(at)}.jsonl`), `${JSON.stringify({ at: at.toISOString(), kind, ...(trim(data) as object) })}\n`, 'utf8');
      } catch {
        // A full disk or a locked file must never stop the app.
      }
    },
    setEnabled(value) {
      on = value;
    },
  };
}
