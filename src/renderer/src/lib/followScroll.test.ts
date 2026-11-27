import { describe, expect, it } from 'vitest';
import type { TranscriptEntry } from '../../../shared/contracts';
import { countableIds, shouldFollow, unseenCount } from './followScroll';

const base = { atBottom: false, unseen: 0, idleMs: 0, hasSelection: false, windowFocused: true };

describe('shouldFollow', () => {
  it('sticks at the bottom', () => {
    expect(shouldFollow({ ...base, atBottom: true, unseen: 3, idleMs: 99999 })).toBe('stick');
  });
  it('does nothing without new messages', () => {
    expect(shouldFollow({ ...base, idleMs: 99999 })).toBe('none');
  });
  it('shows the button for one new message, even when idle', () => {
    expect(shouldFollow({ ...base, unseen: 1, idleMs: 99999 })).toBe('button');
  });
  it('shows the button for several while the user is active', () => {
    expect(shouldFollow({ ...base, unseen: 4, idleMs: 5000 })).toBe('button');
  });
  it('jumps for several once idle for 30 s', () => {
    expect(shouldFollow({ ...base, unseen: 2, idleMs: 30_000 })).toBe('jump');
  });
  it('jumps for several when the window is not focused', () => {
    expect(shouldFollow({ ...base, unseen: 2, windowFocused: false })).toBe('jump');
  });
  it('never jumps while text is selected', () => {
    expect(shouldFollow({ ...base, unseen: 5, idleMs: 99999, hasSelection: true, windowFocused: false })).toBe('button');
  });
});

describe('unseenCount', () => {
  const entries: TranscriptEntry[] = [
    { id: 'u1', kind: 'user', text: 'hej', at: 1 },
    { id: 'a1', kind: 'assistant', text: 'svar', thinking: '', at: 2 },
    { id: 'a2', kind: 'assistant', text: 'sub', thinking: '', agentId: 'x', at: 3 },
    { id: 'a3', kind: 'assistant', text: '  ', thinking: '', at: 4 },
    { id: 'a4', kind: 'assistant', text: 'väntar', thinking: '', held: true, at: 5 },
    { id: 't1', kind: 'tool', name: 'Bash', summary: '', status: 'ok', thinking: '', at: 6 },
    { id: 'u2', kind: 'user', text: 'mer', at: 7 },
  ];
  it('counts only messages that matter', () => {
    expect(countableIds(entries)).toEqual(['u1', 'a1', 'u2']);
  });
  it('counts what is not seen yet', () => {
    expect(unseenCount(entries, new Set(['u1', 'a1']))).toBe(1);
    expect(unseenCount(entries, new Set())).toBe(3);
    expect(unseenCount(entries, new Set(countableIds(entries)))).toBe(0);
  });
});
