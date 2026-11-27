import { describe, expect, it } from 'vitest';
import type { OpenQuestion } from '../../../shared/contracts';
import { composeAnswers, draftKey } from './questionAnswers';

const q = (text: string, kind: OpenQuestion['kind'] = 'question'): OpenQuestion => ({ kind, text, about: '', detail: '', brief: '', options: [] });

describe('composeAnswers', () => {
  it('numbers the questions and marks an empty answer as unanswered', () => {
    const text = composeAnswers([q('Fyra eller sex?'), q('Svart kåpa?', 'assumption')], ['Sex', '  ']);
    expect(text).toContain('1. Fyra eller sex?');
    expect(text).toContain('   Svar: Sex');
    expect(text).toContain('2. Antagande: Svart kåpa?');
    expect(text).toContain('Inget svar');
  });
  it('indents the lines of a multi-line answer', () => {
    expect(composeAnswers([q('A?')], ['rad ett\nrad två'])).toContain('Svar: rad ett\n   rad två');
  });
});

describe('draftKey', () => {
  it('ignores case and surrounding space', () => {
    expect(draftKey(q('  Ska Det Vara Så? '))).toBe('ska det vara så?');
  });
  it('stays the same when the question is reworded', () => {
    const reworded = { ...q('Vill du ha det så?'), previous: 'Ska det vara så?' };
    expect(draftKey(reworded)).toBe(draftKey(q('Ska det vara så?')));
  });
});
