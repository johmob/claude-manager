import { describe, expect, it } from 'vitest';
import { nearlySame } from './textMatch';

describe('nearlySame', () => {
  it('ignores markdown, case and spacing', () => {
    expect(nearlySame('**Klart.**  Allt   gick bra', 'klart. allt gick bra')).toBe(true);
  });
  it('accepts one text inside the other when the lengths are close', () => {
    expect(nearlySame('Klart, allt gick bra idag', 'Klart, allt gick bra')).toBe(true);
    expect(nearlySame('Klart', 'Klart, och här följer en lång förklaring av allt som hände')).toBe(false);
  });
  it('accepts nearly the same words', () => {
    expect(nearlySame('a b c d e f g h i j', 'j i h g f e d c b a')).toBe(true);
    expect(nearlySame('a b c d', 'a b x y')).toBe(false);
  });
  it('is false for empty text', () => {
    expect(nearlySame('', '')).toBe(false);
  });
});
