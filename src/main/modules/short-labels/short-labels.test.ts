import { describe, expect, it } from 'vitest';
import { labelRequest, needsLabel, readLabels } from './index';

describe('short labels', () => {
  it('only long titles need a label', () => {
    expect(needsLabel('SPI driver')).toBe(false);
    expect(needsLabel('Uppdatering av displayens firmware över nätet med signerade och krypterade filer')).toBe(true);
    expect(needsLabel('ett två tre fyra fem sex')).toBe(true);
  });

  it('asks a cheap model with numbered titles and reads the labels in order', () => {
    const request = labelRequest(['Lång rubrik ett', 'Lång rubrik två'], 'C:\\tmp');
    expect(request).toMatchObject({ model: 'haiku', tools: [] });
    expect(request.prompt).toContain('[1] Lång rubrik ett\n[2] Lång rubrik två');
    expect(readLabels({ labels: [{ n: 2, label: 'Rubrik två.' }, { n: 9, label: 'x' }] }, 2)).toEqual(['', 'Rubrik två']);
    expect(readLabels(null, 1)).toEqual(['']);
  });
});
