import { describe, expect, it } from 'vitest';
import { cleanupRequest, readCleanup } from './index';

const ORIGINAL = 'eh alltså jag vill att du typ lägger till en knapp eh som sparar filen';

describe('cleanupRequest', () => {
  it('asks Haiku for a text-only reply with no tools', () => {
    const req = cleanupRequest(ORIGINAL, 'C:/scratch');
    expect(req.model).toBe('haiku');
    expect(req.tools).toEqual([]);
    expect(req.maxTurns).toBe(3);
    expect(req.cwd).toBe('C:/scratch');
    expect(req.schema).toMatchObject({ required: ['text'] });
    expect(req.prompt).toContain(ORIGINAL);
  });
});

describe('readCleanup', () => {
  const rewritten = 'Lägg till en knapp som sparar filen.';

  it('returns the rewritten text, trimmed', () => {
    expect(readCleanup({ text: `  ${rewritten}\n` }, ORIGINAL)).toBe(rewritten);
  });

  it('falls back to the original for malformed replies', () => {
    expect(readCleanup(undefined, ORIGINAL)).toBe(ORIGINAL);
    expect(readCleanup(null, ORIGINAL)).toBe(ORIGINAL);
    expect(readCleanup('text', ORIGINAL)).toBe(ORIGINAL);
    expect(readCleanup({ text: 42 }, ORIGINAL)).toBe(ORIGINAL);
    expect(readCleanup({}, ORIGINAL)).toBe(ORIGINAL);
  });

  it('falls back to the original for an empty reply', () => {
    expect(readCleanup({ text: '   ' }, ORIGINAL)).toBe(ORIGINAL);
  });

  it('falls back when the reply is much longer than the original (it answered instead)', () => {
    const long = 'Ja, här är en lång förklaring. '.repeat(10);
    expect(readCleanup({ text: long }, ORIGINAL)).toBe(ORIGINAL);
  });

  it('falls back when the reply is much shorter than the original', () => {
    expect(readCleanup({ text: 'ok' }, ORIGINAL)).toBe(ORIGINAL);
  });
});
