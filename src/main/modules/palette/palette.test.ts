import { describe, expect, it } from 'vitest';
import { currentColor, pickColor, SESSION_COLORS } from './index';

describe('palette', () => {
  it('has 12 unique colours', () => {
    expect(new Set(SESSION_COLORS).size).toBe(12);
  });

  it('picks the first unused colour', () => {
    expect(pickColor([])).toBe(SESSION_COLORS[0]);
    expect(pickColor([SESSION_COLORS[0], SESSION_COLORS[2]])).toBe(SESSION_COLORS[1]);
  });

  it('replaces an earlier bright colour with its muted counterpart, and keeps others', () => {
    expect(currentColor('#5AA9FF')).toBe(SESSION_COLORS[0]);
    expect(currentColor('#f472b6')).toBe(SESSION_COLORS[11]);
    expect(currentColor('#123456')).toBe('#123456');
  });

  it('picks the least used when all are taken', () => {
    const used = [...SESSION_COLORS, ...SESSION_COLORS.filter((c) => c !== SESSION_COLORS[5])];
    expect(pickColor(used)).toBe(SESSION_COLORS[5]);
  });
});
