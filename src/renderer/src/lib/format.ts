import type { ModelChoice, PermissionChoice, SessionStatus, TodoTree } from '../../../shared/contracts';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  starting: 'Startar',
  working: 'Arbetar',
  waiting: 'Väntar på dig',
  done: 'Klar',
  idle: 'Vilar',
  error: 'Fel',
  stopped: 'Stoppad',
};

export const MODEL_LABEL: Record<ModelChoice, string> = {
  default: 'Standard',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable (endast stor planering)',
};

export const MODEL_SHORT: Record<ModelChoice, string> = {
  default: 'Standard',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
};

export const PERMISSION_LABEL: Record<PermissionChoice, string> = {
  auto: 'Auto (fråga bara vid osäkerhet)',
  default: 'Fråga alltid',
  acceptEdits: 'Godkänn filändringar',
  plan: 'Planeringsläge',
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** "m:ss" or "h:mm:ss". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const WEEKDAYS = ['sön', 'mån', 'tis', 'ons', 'tors', 'fre', 'lör'];

/** "Återställs 14:30" or, with weekday, "Återställs fre 15:00". */
export function formatReset(iso: string | null, withWeekday: boolean): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `Återställs ${withWeekday ? `${WEEKDAYS[d.getDay()]} ` : ''}${time}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.round((n / 1_000_000) * 10) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** 1-2 letter monogram from a session name. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export interface TodoProgress {
  done: number;
  total: number;
}

/** Done/total over steps (blocks without steps count as one unit). */
export function todoProgress(todo: TodoTree): TodoProgress {
  let done = 0;
  let total = 0;
  for (const block of todo.blocks) {
    if (block.steps.length === 0) {
      total += 1;
      if (block.status === 'done') done += 1;
    } else {
      total += block.steps.length;
      done += block.steps.filter((s) => s.status === 'done').length;
    }
  }
  return { done, total };
}
