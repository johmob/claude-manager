// focus-rules: which sessions are shown in Fokus. Pure functions over session records, so the
// composition root decides when to apply them and saves what changed.
import type { SessionRecord } from '../../../shared/contracts';

/** At most this many sessions are shown side by side. */
export const FOCUS_LIMIT = 6;
/** A session leaves Fokus after this long without a message or a finished turn. */
export const FOCUS_IDLE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Puts `id` in Fokus. When that makes more than FOCUS_LIMIT, the focused sessions that have been idle
 * the longest leave (never `id` itself). Returns the records that changed.
 */
export function bringIntoFocus(records: readonly SessionRecord[], id: string): SessionRecord[] {
  const target = records.find((r) => r.id === id && !r.archived);
  if (!target) return [];
  const others = records
    .filter((r) => r.focused && !r.archived && r.id !== id)
    .sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt));
  const dropped = others.slice(FOCUS_LIMIT - 1).map((r) => ({ ...r, focused: false }));
  return target.focused ? dropped : [{ ...target, focused: true }, ...dropped];
}

/** Focused sessions idle for longer than FOCUS_IDLE_MS leave Fokus. Returns the records that changed. */
export function expireFocus(records: readonly SessionRecord[], now: number): SessionRecord[] {
  return records.filter((r) => r.focused && now - Date.parse(r.lastActiveAt) > FOCUS_IDLE_MS).map((r) => ({ ...r, focused: false }));
}
