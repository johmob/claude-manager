import type { ChatDetail, TaggedBlock } from './contracts';
import { tagShows } from './contracts';

/** About how many characters of the answer show before "Visa N stycken till"; the turn tagger is told the same. */
export const ANSWER_ROOM_CHARS = 1600;

/**
 * Which blocks of an answer show: those at the chat's detail always, the rest are added in document order
 * while the shown total stays within `room` (a block that does not fit is skipped). An answer that fits whole shows whole.
 */
export function shownBlocks(blocks: TaggedBlock[], detail: ChatDetail, room: number): boolean[] {
  const total = blocks.reduce((n, b) => n + b.text.length, 0);
  if (total <= room) return blocks.map(() => true);
  const shown = blocks.map((b) => b.tag === null || tagShows(b.tag, detail));
  let used = blocks.reduce((n, b, i) => n + (shown[i] ? b.text.length : 0), 0);
  blocks.forEach((b, i) => {
    if (shown[i]) return;
    if (used + b.text.length <= room) {
      shown[i] = true;
      used += b.text.length;
    }
  });
  return shown;
}
