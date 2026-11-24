import { describe, expect, it } from 'vitest';
import { shownBlocks } from './answerRoom';
import type { TaggedBlock } from './contracts';

const b = (n: number, tag: TaggedBlock['tag']): TaggedBlock => ({ text: 'x'.repeat(n), tag });

describe('shownBlocks', () => {
  it('shows a short answer whole', () => {
    expect(shownBlocks([b(100, 'answer'), b(100, 'background')], 'minimal', 1600)).toEqual([true, true]);
  });
  it('always shows blocks at the detail, fills the rest in order while they fit', () => {
    const blocks = [b(500, 'answer'), b(900, 'background'), b(300, 'progress'), b(200, 'plan')];
    expect(shownBlocks(blocks, 'minimal', 1600)).toEqual([true, true, false, true]);
  });
  it('shows blocks at the detail even over the room', () => {
    expect(shownBlocks([b(2000, 'answer'), b(10, 'plan')], 'minimal', 1600)).toEqual([true, false]);
  });
});
