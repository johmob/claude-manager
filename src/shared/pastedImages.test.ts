import { describe, expect, it } from 'vitest';
import { splitImageRefs, withImages } from './pastedImages';

describe('pasted images', () => {
  it('adds one line per image after the text', () => {
    expect(withImages('Vad är det?', ['C:/t/a.png', 'C:/t/b.png'])).toBe('Vad är det?\n\n[Bild: C:/t/a.png]\n[Bild: C:/t/b.png]');
  });
  it('lets images stand alone', () => {
    expect(withImages('  ', ['C:/t/a.png'])).toBe('[Bild: C:/t/a.png]');
  });
  it('keeps a slash command first', () => {
    expect(withImages('/compact', ['C:/t/a.png']).startsWith('/compact')).toBe(true);
  });
  it('splits a message back into text and paths', () => {
    expect(splitImageRefs(withImages('Hej\nvarsågod', ['C:/mina bilder/a.png']))).toEqual({ text: 'Hej\nvarsågod', images: ['C:/mina bilder/a.png'] });
    expect(splitImageRefs('Bara text')).toEqual({ text: 'Bara text', images: [] });
  });
});
