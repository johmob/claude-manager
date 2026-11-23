import { describe, expect, it } from 'vitest';
import type { StructuredRequest, TranscriptEntry } from '../../../shared/contracts';
import { digestTurn, reviewTurn } from './index';

const tool = (id: string, summary: string): TranscriptEntry => ({ id, kind: 'tool', name: 'Bash', summary, status: 'ok', thinking: '', at: 0 });

const entries: TranscriptEntry[] = [
  { id: '1', kind: 'user', text: 'gammal fråga', at: 0 },
  tool('2', 'ls'),
  { id: '3', kind: 'user', text: 'bygg servern', at: 0 },
  tool('4', 'node test.js'),
  tool('5', 'rm notes.txt'),
  tool('6', 'node server.js'),
  { id: '7', kind: 'assistant', text: 'Klart.', thinking: 'tänkte', at: 0 },
];

describe('digestTurn', () => {
  it('covers only the latest turn', () => {
    const digest = digestTurn(entries);
    expect(digest.toolCalls).toBe(3);
    expect(digest.text).toBe(['USER: bygg servern', 'TOOL Bash [ok]: node test.js', 'TOOL Bash [ok]: rm notes.txt', 'TOOL Bash [ok]: node server.js', 'AGENT: Klart.'].join('\n'));
  });

  it('keeps the start and the end of a long turn', () => {
    const long = [{ id: 'u', kind: 'user', text: 'start', at: 0 } as TranscriptEntry, ...Array.from({ length: 400 }, (_, i) => tool(`t${i}`, `step ${i}`))];
    const { text } = digestTurn(long);
    expect(text.length).toBeLessThan(8100);
    expect(text.startsWith('USER: start')).toBe(true);
    expect(text.endsWith('step 399')).toBe(true);
  });
});

describe('reviewTurn', () => {
  it('skips turns with little work without calling Claude', async () => {
    let called = false;
    const note = await reviewTurn({ text: 'USER: hej', toolCalls: 1 }, async () => ((called = true), null), 'C:\\');
    expect(note).toBeNull();
    expect(called).toBe(false);
  });

  it('asks Haiku without tools and returns the note', async () => {
    let request: StructuredRequest | null = null;
    const note = await reviewTurn(digestTurn(entries), async (r) => ((request = r), { worthKnowing: true, kind: 'caution', title: 'notes.txt raderades', text: 'Filen togs bort med rm.' }), 'C:\\x');
    expect(note).toEqual({ kind: 'caution', title: 'notes.txt raderades', text: 'Filen togs bort med rm.', source: 'review' });
    expect(request).toMatchObject({ model: 'haiku', tools: [], cwd: 'C:\\x' });
  });

  it('returns null when nothing is worth knowing', async () => {
    expect(await reviewTurn(digestTurn(entries), async () => ({ worthKnowing: false, kind: 'note', title: '', text: '' }), 'C:\\')).toBeNull();
  });
});
