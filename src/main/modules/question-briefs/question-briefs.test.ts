import { describe, expect, it } from 'vitest';
import { briefRequest, readBriefs } from './index';

describe('question briefs', () => {
  it('asks a cheap model with the answer and the numbered questions', () => {
    const request = briefRequest(
      [
        { kind: 'question', text: 'Vill du ha A eller B?', context: '', detail: '', brief: '' },
        { kind: 'assumption', text: 'Kortet är rev B', context: '', detail: '', brief: '' },
      ],
      'A är snabbt. B är billigt.',
      'C:\\tmp',
    );
    expect(request).toMatchObject({ model: 'haiku', tools: [], cwd: 'C:\\tmp' });
    expect(request.prompt).toContain('A är snabbt. B är billigt.');
    expect(request.prompt).toContain('1. Vill du ha A eller B?\n2. Antagande: Kortet är rev B');
  });

  it('reads one brief per question and tolerates a bad reply', () => {
    expect(readBriefs({ briefs: [' A går fort. ', 'x'.repeat(300)] }, 3).map((b) => b.length)).toEqual([11, 240, 0]);
    expect(readBriefs(null, 2)).toEqual(['', '']);
  });
});
