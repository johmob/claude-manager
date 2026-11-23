import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createJsonStore } from './index';

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'jsonstore-'));

describe('json-store', () => {
  it('returns defaults when the file is missing', () => {
    expect(createJsonStore(join(tempDir(), 'a.json'), { n: 1 }).read()).toEqual({ n: 1 });
  });

  it('writes atomically into a new directory and reads back', () => {
    const dir = tempDir();
    const file = join(dir, 'sub', 'a.json');
    const store = createJsonStore(file, { n: 0 });
    store.write({ n: 5 });
    expect(store.read()).toEqual({ n: 5 });
    expect(readFileSync(file, 'utf8')).toContain('\n');
    expect(readdirSync(join(dir, 'sub'))).toEqual(['a.json']);
  });

  it('returns defaults on corrupt JSON or failed validation', () => {
    const file = join(tempDir(), 'a.json');
    writeFileSync(file, '{oops');
    expect(createJsonStore(file, 7).read()).toBe(7);
    writeFileSync(file, '"x"');
    expect(createJsonStore<number>(file, 7, () => null).read()).toBe(7);
  });
});
