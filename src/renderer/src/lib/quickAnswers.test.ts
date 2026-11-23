import { describe, expect, it } from 'vitest';
import { quickAnswers } from './quickAnswers';

describe('quickAnswers', () => {
  it('offers Ja and Nej for a yes/no question', () => {
    expect(quickAnswers('Ska jag börja med byggsystemet?')).toEqual(['Ja', 'Nej']);
    expect(quickAnswers('Behåller vi 9600 baud?')).toEqual(['Ja', 'Nej']);
  });

  it('offers the options of a short either/or question', () => {
    expect(quickAnswers('Vill du ha A eller B?')).toEqual(['A', 'B']);
    expect(quickAnswers('Rev B, rev C eller rev D?')).toEqual(['Rev B', 'rev C', 'rev D']);
  });

  it('offers nothing for open questions, long options or statements', () => {
    expect(quickAnswers('Vilken port ska jag använda?')).toEqual([]);
    expect(quickAnswers('Hur vill du att jag gör?')).toEqual([]);
    expect(quickAnswers('Ska jag skriva om hela modulen från grunden eller bara rätta felet i parsern?')).toEqual([]);
    expect(quickAnswers('Kortet är rev B')).toEqual([]);
  });
});
