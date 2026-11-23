import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '../../../shared/contracts';
import { bringIntoFocus, expireFocus, FOCUS_IDLE_MS, FOCUS_LIMIT } from './index';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-23T12:00:00Z');

function record(id: string, focused: boolean, idleMs: number, archived = false): SessionRecord {
  return {
    id,
    name: id,
    color: '#fff',
    kind: 'project',
    cwd: 'C:\\Kod',
    model: 'opus',
    effort: 'medium',
    permissionMode: 'auto',
    createdAt: '2026-11-01T00:00:00Z',
    archived,
    focused,
    lastActiveAt: new Date(NOW - idleMs).toISOString(),
  };
}

describe('bringIntoFocus', () => {
  it('focuses the session and changes nothing else when there is room', () => {
    const records = [record('a', true, DAY), record('b', false, 2 * DAY)];
    expect(bringIntoFocus(records, 'b')).toEqual([{ ...records[1], focused: true }]);
  });

  it('drops the longest-idle focused sessions when over the limit', () => {
    const focused = Array.from({ length: FOCUS_LIMIT }, (_, i) => record(`f${i}`, true, i * 1000));
    const changed = bringIntoFocus([...focused, record('new', false, 5 * DAY)], 'new');
    expect(changed.map((r) => [r.id, r.focused])).toEqual([
      ['new', true],
      [`f${FOCUS_LIMIT - 1}`, false],
    ]);
  });

  it('does nothing for an already focused session with room, or an archived one', () => {
    expect(bringIntoFocus([record('a', true, 0)], 'a')).toEqual([]);
    expect(bringIntoFocus([record('x', false, 0, true)], 'x')).toEqual([]);
  });
});

describe('expireFocus', () => {
  it('removes focus from sessions idle longer than the limit only', () => {
    const records = [record('fresh', true, FOCUS_IDLE_MS - 1000), record('stale', true, FOCUS_IDLE_MS + 1000), record('off', false, 10 * DAY)];
    expect(expireFocus(records, NOW)).toEqual([{ ...records[1], focused: false }]);
  });
});
