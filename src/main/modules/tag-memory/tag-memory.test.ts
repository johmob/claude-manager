import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTagMemory } from './index';

describe('tag memory', () => {
  const dirs: string[] = [];
  const fresh = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-tags-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('keeps tags across instances, by message text, until forgotten', () => {
    const dir = fresh();
    createTagMemory(dir).remember('s1', [{ text: 'Allt klart.', tags: ['result'] }, { text: 'Ett\n\nTvå', tags: ['pass', null] }]);
    const later = createTagMemory(dir);
    expect(later.recall('s1', 'Ett\n\nTvå')).toEqual(['pass', null]);
    expect(later.recall('s1', 'Okänt')).toBeUndefined();
    expect(later.recall('s2', 'Allt klart.')).toBeUndefined();
    later.forget('s1');
    expect(createTagMemory(dir).recall('s1', 'Allt klart.')).toBeUndefined();
  });
});
