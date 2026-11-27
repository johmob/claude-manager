import type { TranscriptEntry } from '../../../shared/contracts';

export type FollowAction = 'stick' | 'jump' | 'button' | 'none';

/** Idle time in the transcript before it may scroll down on its own. */
export const FOLLOW_IDLE_MS = 30_000;

/**
 * What the transcript does when something may have arrived below the view. Never scrolls while the user
 * reads (a selection, or recent wheel/mouse/keyboard activity): then at most the "N nya" button shows.
 */
export function shouldFollow(s: { atBottom: boolean; unseen: number; idleMs: number; hasSelection: boolean; windowFocused: boolean }): FollowAction {
  if (s.atBottom) return 'stick';
  if (s.unseen <= 0) return 'none';
  if (s.hasSelection) return 'button';
  if (s.unseen >= 2 && (s.idleMs >= FOLLOW_IDLE_MS || !s.windowFocused)) return 'jump';
  return 'button';
}

/** Ids of the entries that count as "new messages": yours, the main agent's text, callouts and questions. */
export function countableIds(entries: TranscriptEntry[]): string[] {
  const ids: string[] = [];
  for (const e of entries) {
    if (e.kind === 'user' || e.kind === 'callout' || e.kind === 'question') ids.push(e.id);
    else if (e.kind === 'assistant' && e.text.trim() && !e.agentId && !e.held) ids.push(e.id);
  }
  return ids;
}

/** How many countable entries are not in `seen` (the ids that were there when the user last was at the bottom). */
export function unseenCount(entries: TranscriptEntry[], seen: ReadonlySet<string>): number {
  let n = 0;
  for (const id of countableIds(entries)) if (!seen.has(id)) n++;
  return n;
}
