import { describe, expect, it } from 'vitest';
import { messagesForTagging, readTags, tagRequest } from './index';

describe('turn tags', () => {
  it('asks a cheap model with the numbered messages of the turn', () => {
    const request = tagRequest(['Jag startar E.', 'Välj 1 eller 1b för greppet.'], 'C:\\tmp');
    expect(request).toMatchObject({ model: 'haiku', tools: [] });
    expect(request.prompt).toContain('[1]\nJag startar E.\n\n[2]\nVälj 1 eller 1b för greppet.');
  });

  it('keeps only the last messages, each cut to a sane length', () => {
    const texts = Array.from({ length: 20 }, (_, i) => `m${i}`);
    expect(messagesForTagging(texts)).toHaveLength(12);
    expect(messagesForTagging(['x'.repeat(5000)])[0]!.length).toBe(4001);
  });

  it('reads questions and messages to keep, dropping anything out of range', () => {
    const tags = readTags(
      {
        questions: [
          { text: 'Ska greppet vara 1 eller 1b?', kind: 'question', options: ['1', '1b'], brief: 'Två greppvarianter.', message: 1 },
          { text: 'Fel nummer', kind: 'question', options: [], brief: '', message: 9 },
        ],
        keep: [1, 2, 7],
      },
      2,
    );
    expect(tags).toEqual({
      questions: [{ text: 'Ska greppet vara 1 eller 1b?', kind: 'question', options: ['1', '1b'], brief: 'Två greppvarianter.', message: 1 }],
      keep: [1, 2],
    });
    expect(readTags(null, 2)).toBeNull();
  });
});
