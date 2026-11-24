// day-tokens: counts the tokens processed today (local date), split into the user's sessions and the
// app's own helper calls (tagging turns, picking icons, summaries …), so the app can show what running it
// costs. Pure: the composition root keeps the value and saves it.
import type { DayTokens } from '../../../shared/contracts';

/** The local date, "2026-11-24". */
export function localDate(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Adds tokens to today's count; a new day starts from zero. */
export function addTokens(day: DayTokens, today: string, kind: 'sessions' | 'app', tokens: number): DayTokens {
  const base = day.date === today ? day : { date: today, sessions: 0, app: 0 };
  return { ...base, [kind]: base[kind] + Math.max(0, tokens) };
}

/** Today's count as of `today` (zero when the saved one is from another day). */
export function todayOf(day: DayTokens, today: string): DayTokens {
  return day.date === today ? day : { date: today, sessions: 0, app: 0 };
}
