import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppLog } from './index';

describe('app log', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('writes one line per record to the day file, cuts long text, stops when switched off and drops old files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-log-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'app-2020-01-01.jsonl'), '');
    const log = createAppLog(dir, true, () => new Date('2026-11-24T10:00:00Z'));
    expect(readdirSync(dir)).toEqual([]);
    log.write('event', { sessionId: 's1', text: 'x'.repeat(5000) });
    log.setEnabled(false);
    log.write('event', { sessionId: 's1', text: 'inte loggat' });
    const lines = readFileSync(join(dir, 'app-2026-11-24.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({ at: '2026-11-24T10:00:00.000Z', kind: 'event', sessionId: 's1' });
    expect(record.text).toMatch(/… \[5000 tecken\]$/);
  });
});
