import { describe, expect, it } from 'vitest';
import { messagesForTagging, readTags, splitBlocks, tagRequest, taggedBlocks } from './index';

describe('turn tags', () => {
  it('splits a message into blocks at blank lines, keeping code blocks and lone headings whole', () => {
    const text = [
      'Slutkörningen gav 26 av 30 OK. E rättar de fyra som återstår:',
      '',
      '- Räfflorna slutar före huset.',
      '- Nätfelen är rättade.',
      '',
      '**Övriga kontroller**',
      '',
      'Hållfasthet: faktor 6,3.',
      '',
      '```',
      'a',
      '',
      'b',
      '```',
    ].join('\n');
    expect(splitBlocks(text)).toEqual([
      'Slutkörningen gav 26 av 30 OK. E rättar de fyra som återstår:\n\n- Räfflorna slutar före huset.\n- Nätfelen är rättade.',
      '**Övriga kontroller**\n\nHållfasthet: faktor 6,3.',
      '```\na\n\nb\n```',
    ]);
  });

  it('asks a cheap model with numbered blocks', () => {
    const request = tagRequest([['Jag startar E.'], ['Välj 1 eller 1b.', 'Bakgrund.']], 'C:\\tmp');
    expect(request).toMatchObject({ model: 'haiku', tools: [] });
    expect(request.prompt).toContain('[1.1]\nJag startar E.\n\n[2.1]\nVälj 1 eller 1b.\n\n[2.2]\nBakgrund.');
  });

  it('keeps the last messages, dropping older ones when there are too many blocks', () => {
    expect(messagesForTagging(Array.from({ length: 20 }, (_, i) => `m${i}`))).toHaveLength(12);
    const long = Array.from({ length: 50 }, (_, i) => `b${i}`).join('\n\n');
    expect(messagesForTagging([long, long]).map((m) => m.length)).toEqual([50]);
  });

  it('reads block tags and questions, dropping anything out of range or unknown', () => {
    const tags = readTags(
      {
        blocks: [
          { id: '1.1', tag: 'result' },
          { id: '2.2', tag: 'fail' },
          { id: '2.9', tag: 'pass' },
          { id: '1.1x', tag: 'pass' },
          { id: '2.1', tag: 'nonsense' },
        ],
        questions: [
          { text: 'Ska greppet vara 1 eller 1b?', kind: 'question', options: ['1', '1b'], brief: 'Två greppvarianter.', message: 2 },
          { text: 'Fel nummer', kind: 'question', options: [], brief: '', message: 9 },
        ],
      },
      [1, 2],
    );
    expect(tags).toEqual({
      tags: [['result'], [null, 'fail']],
      questions: [{ text: 'Ska greppet vara 1 eller 1b?', kind: 'question', options: ['1', '1b'], brief: 'Två greppvarianter.', message: 2 }],
    });
    expect(readTags(null, [1])).toBeNull();
    expect(taggedBlocks(['a', 'b'], ['pass'])).toEqual([{ text: 'a', tag: 'pass' }, { text: 'b', tag: null }]);
  });
});
