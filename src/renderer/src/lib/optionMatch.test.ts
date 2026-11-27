import { describe, expect, it } from 'vitest';
import { isSendCommand, matchSpokenOption } from './optionMatch';

describe('matchSpokenOption', () => {
  it('matches digits and number words', () => {
    const opts = ['1', '2', '3'];
    expect(matchSpokenOption('2', opts)).toBe(1);
    expect(matchSpokenOption('två', opts)).toBe(1);
    expect(matchSpokenOption('Tvåan.', opts)).toBe(1);
    expect(matchSpokenOption('jag tar alternativ två', opts)).toBe(1);
    expect(matchSpokenOption('eh, alltså jag väljer två', opts)).toBe(1);
    expect(matchSpokenOption('tre', opts)).toBe(2);
    expect(matchSpokenOption('fyra', opts)).toBeNull();
  });

  it('matches numbers with letters', () => {
    const opts = ['1a', '1b', '2'];
    expect(matchSpokenOption('1b', opts)).toBe(1);
    expect(matchSpokenOption('1 b', opts)).toBe(1);
    expect(matchSpokenOption('b', opts)).toBe(1);
    expect(matchSpokenOption('alternativ 2', opts)).toBe(2);
    expect(matchSpokenOption('a-alternativet', opts)).toBe(0);
  });

  it('gives null when a bare number fits several options', () => {
    expect(matchSpokenOption('1', ['1a', '1b', '2'])).toBeNull();
  });

  it('matches letters', () => {
    const opts = ['A', 'B'];
    expect(matchSpokenOption('B', opts)).toBe(1);
    expect(matchSpokenOption('be', opts)).toBe(1);
    expect(matchSpokenOption('a', opts)).toBe(0);
    expect(matchSpokenOption('alternativ a', opts)).toBe(0);
    expect(matchSpokenOption('ce', opts)).toBeNull();
  });

  it('matches yes and no options', () => {
    expect(matchSpokenOption('Stämmer', ['Stämmer'])).toBe(0);
    expect(matchSpokenOption('det stämmer', ['Stämmer'])).toBe(0);
    expect(matchSpokenOption('ja', ['Stämmer'])).toBe(0);
    expect(matchSpokenOption('nej', ['Stämmer'])).toBeNull();

    const yesNo = ['Ja', 'Nej'];
    expect(matchSpokenOption('ja', yesNo)).toBe(0);
    expect(matchSpokenOption('japp', yesNo)).toBe(0);
    expect(matchSpokenOption('absolut', yesNo)).toBe(0);
    expect(matchSpokenOption('nej tack', yesNo)).toBe(1);
    expect(matchSpokenOption('nä', yesNo)).toBe(1);
  });

  it('matches long options by word overlap', () => {
    const opts = ['Använd en databas med indexering', 'Spara i en fil på disk'];
    expect(matchSpokenOption('vi kör databas med indexering', opts)).toBe(0);
    expect(matchSpokenOption('spara i en fil', opts)).toBe(1);
  });

  it('gives null when several options match', () => {
    expect(matchSpokenOption('lägg till knapp', ['Lägg till en knapp', 'Lägg till en knapp nu'])).toBeNull();
    expect(matchSpokenOption('lägg till en knapp', ['Lägg till en knapp', 'Lägg till en meny'])).toBe(0);
  });

  it('gives null for empty or unrelated speech', () => {
    expect(matchSpokenOption('', ['1', '2'])).toBeNull();
    expect(matchSpokenOption('eh öh', ['1', '2'])).toBeNull();
    expect(matchSpokenOption('nej tack', ['1', '2', '3'])).toBeNull();
  });
});

describe('isSendCommand', () => {
  it('recognises send commands', () => {
    expect(isSendCommand('skicka')).toBe(true);
    expect(isSendCommand('Skicka svaren.')).toBe(true);
    expect(isSendCommand('skicka svar')).toBe(true);
    expect(isSendCommand('klart, skicka')).toBe(true);
  });

  it('rejects other speech', () => {
    expect(isSendCommand('skicka en fil')).toBe(false);
    expect(isSendCommand('nej tack')).toBe(false);
    expect(isSendCommand('ja')).toBe(false);
  });
});
