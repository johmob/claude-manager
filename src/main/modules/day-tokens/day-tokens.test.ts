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

describe('usage weight', () => {
  it('weighs cache reads lightly and the cheap model low, like the plan does', async () => {
    const { usageWeight } = await import('../../../shared/contracts');
    const haikuCall = usageWeight({ input: 4000, output: 300, cacheRead: 0, cacheWrite: 0 }, 'haiku');
    const opusTurn = usageWeight({ input: 2000, output: 1500, cacheRead: 200000, cacheWrite: 5000 }, 'opus');
    expect(haikuCall).toBe(5500);
    expect(opusTurn).toBe(5 * (2000 + 6250 + 20000 + 7500));
  });
});

describe('when text', () => {
  it('says the time today, "i morgon" tomorrow, and the day further away', async () => {
    const { whenText } = await import('../../../shared/contracts');
    const now = new Date(2026, 10, 24, 10, 0);
    expect(whenText(new Date(2026, 10, 24, 14, 20).toISOString(), now)).toBe('kl 14:20');
    expect(whenText(new Date(2026, 10, 25, 9, 0).toISOString(), now)).toBe('i morgon kl 09:00');
    expect(whenText(new Date(2026, 10, 28, 9, 0).toISOString(), now)).toMatch(/28 nov\.? kl 09:00$/);
    expect(whenText('', now)).toBe('');
  });
});
