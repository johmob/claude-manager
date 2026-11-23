import type { CalloutKind, EffortChoice, PermissionChoice, SessionStatus } from '../../../shared/contracts';

/** "nyss", "12 min sedan", "3 h sedan", "2 d sedan". */
export function formatAgo(epochMs: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - epochMs) / 60_000));
  if (minutes < 1) return 'nyss';
  if (minutes < 60) return `${minutes} min sedan`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h sedan` : `${Math.round(hours / 24)} d sedan`;
}

export const CALLOUT_LABEL: Record<CalloutKind, string> = {
  caution: 'Risk',
  warning: 'Varning',
  question: 'Fråga till dig',
  important: 'Bra att veta',
  note: 'Antagande',
  tip: 'Förslag',
};

export const STATUS_LABEL: Record<SessionStatus, string> = {
  starting: 'Startar',
  working: 'Arbetar',
  waiting: 'Väntar på dig',
  done: 'Klar',
  idle: 'Vilar',
  error: 'Fel',
  stopped: 'Stoppad',
  limited: 'Gräns nådd',
};

export const EFFORT_LABEL: Record<EffortChoice, string> = {
  default: 'Standard',
  low: 'Låg',
  medium: 'Medel',
  high: 'Hög',
  xhigh: 'Extra hög',
  max: 'Max',
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

/** Tokens used so far: "35k", and from a million on "1,2 M" (Swedish decimal comma). */
export function formatTokenTotal(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} M`;
  return formatTokens(n);
}

/** 1-2 letter monogram from a session name. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
