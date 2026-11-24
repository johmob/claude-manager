import { describe, expect, it } from 'vitest';
import { addTokens, localDate, todayOf } from './index';

describe('day tokens', () => {
  it('adds to today and starts over on a new day', () => {
    const start = { date: '2026-11-24', sessions: 1000, app: 20 };
    expect(addTokens(start, '2026-11-24', 'app', 30)).toEqual({ date: '2026-11-24', sessions: 1000, app: 50 });
    expect(addTokens(start, '2026-11-25', 'sessions', 5)).toEqual({ date: '2026-11-25', sessions: 5, app: 0 });
    expect(todayOf(start, '2026-11-25')).toEqual({ date: '2026-11-25', sessions: 0, app: 0 });
  });

  it('writes the local date', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
