import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveTerminals } from './index';

function registry(entries: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-terminals-'));
  mkdirSync(join(dir, 'sessions'));
  for (const [file, body] of Object.entries(entries)) writeFileSync(join(dir, 'sessions', file), typeof body === 'string' ? body : JSON.stringify(body));
  return dir;
}

describe('liveTerminals', () => {
  it('lists running interactive sessions only', () => {
    const dir = registry({
      [`${process.pid}.json`]: { pid: process.pid, sessionId: 'a', cwd: 'C:\Kod\X', name: 'x-1', status: 'idle', kind: 'interactive' },
      '999999991.json': { pid: 999999991, sessionId: 'dead', status: 'busy', kind: 'interactive' },
      '1.json': { pid: process.pid, sessionId: 'sdk', kind: 'sdk' },
      '2.json': 'not json',
      [`${process.pid}.abc.key`]: { peerToken: 'x' },
    });
    expect(liveTerminals(dir)).toEqual([{ sessionId: 'a', pid: process.pid, status: 'idle', name: 'x-1', cwd: 'C:\Kod\X' }]);
  });

  it('maps unknown status values and copes with a missing folder', () => {
    const dir = registry({ [`${process.pid}.json`]: { pid: process.pid, sessionId: 'b', status: 'something-new' } });
    expect(liveTerminals(dir)[0]?.status).toBe('unknown');
    expect(liveTerminals(join(dir, 'missing'))).toEqual([]);
  });
});
