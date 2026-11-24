import { describe, expect, it } from 'vitest';
import { compactCheckRequest, readCompactCheck } from './index';

describe('compact check', () => {
  it('asks a cheap model with the answer', () => {
    const request = compactCheckRequest('Jag är redo.', 'C:\tmp');
    expect(request).toMatchObject({ model: 'haiku', tools: [] });
    expect(request.prompt).toContain('Jag är redo.');
  });

  it('reads the verdict and rejects bad replies', () => {
    expect(readCompactCheck({ verdict: 'ready', reason: ' Klar. ' })).toEqual({ verdict: 'ready', reason: 'Klar.' });
    expect(readCompactCheck({ verdict: 'not_ready', reason: 'x'.repeat(400) })?.reason.length).toBe(300);
    expect(readCompactCheck({ verdict: 'maybe', reason: '' })).toBeNull();
    expect(readCompactCheck(null)).toBeNull();
  });
});
