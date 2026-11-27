import { describe, expect, it } from 'vitest';
import { ANSWER_ROOM_CHARS } from '../../../shared/answerRoom';
import { messagesForTagging, questionDetail, readTags, splitBlocks, tagRequest, taggedBlocks } from './index';

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
    expect(tagRequest([['x']], 'C:\\tmp', ['cad.2 Handtag v4']).prompt).toContain('Pågående punkter i arbetsschemat:\n- cad.2 Handtag v4');
    expect(request.prompt).toContain('[1.1]\nJag startar E.\n\n[2.1]\nVälj 1 eller 1b.\n\n[2.2]\nBakgrund.');
  });

  it('tells the tagger how much of the answer shows', () => {
    expect(tagRequest([['x']], 'C:\tmp').prompt).toContain(`ungefär ${ANSWER_ROOM_CHARS} tecken`);
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
          { text: 'Ska greppet vara 1 eller 1b?', kind: 'question', about: 'cad.2 Handtag v4', options: ['1', '1b'], brief: 'Två greppvarianter.', message: 2, context: ['1.1', '2.2', '7.1'] },
          { text: 'Fel nummer', kind: 'question', options: [], brief: '', message: 9 },
          { text: 'Samma som förut?', kind: 'question', options: [], brief: '', message: 1, same: 'S' },
        ],
      },
      [1, 2],
    );
    expect(tags).toEqual({
      tags: [['result'], [null, 'fail']],
      questions: [{ text: 'Ska greppet vara 1 eller 1b?', kind: 'question', about: 'cad.2 Handtag v4', options: ['1', '1b'], brief: 'Två greppvarianter.', message: 2, replaces: null, context: [[1, 1], [2, 2]] }],
    });
    expect(readTags(null, [1])).toBeNull();
    expect(taggedBlocks(['a', 'b'], ['pass'])).toEqual([{ text: 'a', tag: 'pass' }, { text: 'b', tag: null }]);
  });
  it('maps a reworded repeat of an open question to its text, and treats a bad number as new', () => {
    const q = (text: string, same: string) => ({ text, kind: 'question', about: '', options: [], brief: '', message: 1, same, context: [] });
    const tags = readTags({ blocks: [], questions: [q('Fyra eller sex?', 'Ö2'), q('Svart?', 'Ö9'), q('Ny?', ''), q('Redan svarad?', 'S')] }, [1], ['Första?', 'Fyra eller sex skruvar?']);
    expect(tags?.questions.map((x) => [x.text, x.replaces])).toEqual([['Fyra eller sex?', 'Fyra eller sex skruvar?'], ['Svart?', null], ['Ny?', null]]);
  });
  it('numbers the open questions in the request', () => {
    const prompt = tagRequest([['a']], '.', [], { open: ['Första?', 'Andra?'], answered: [] }).prompt;
    expect(prompt).toContain('Ö1. Första?');
    expect(prompt).toContain('Ö2. Andra?');
  });
  it('drops markup and blocks that only repeat the question from its background', () => {
    const q = 'Hur ska läget mappa avtryckaren: vilken nivå när den precis är intryckt och när den är helt intryckt?';
    expect(questionDetail(['> [!QUESTION] **Läget:** Hur ska läget mappa avtryckaren: vilken nivå när den precis är intryckt och när helt intryckt?', 'Nuvarande intervall är 10–75 kPa.', '![bild](C:/x.png)'], q)).toBe('Nuvarande intervall är 10–75 kPa.\n\n![bild](C:/x.png)');
    expect(questionDetail(['[!NOTE] Spänningen antas vara 24 V.'], 'Stämmer det?')).toBe('Spänningen antas vara 24 V.');
  });
});
