import { describe, expect, it } from 'vitest';
import { pickColor, SESSION_COLORS } from './index';

describe('palette', () => {
  it('has 12 unique colours', () => {
    expect(new Set(SESSION_COLORS).size).toBe(12);
  });

  it('picks the first unused colour', () => {
    expect(pickColor([])).toBe(SESSION_COLORS[0]);
    expect(pickColor([SESSION_COLORS[0], SESSION_COLORS[2]])).toBe(SESSION_COLORS[1]);
  });

  it('picks the least used when all are taken', () => {
    const used = [...SESSION_COLORS, ...SESSION_COLORS.filter((c) => c !== SESSION_COLORS[5])];
    expect(pickColor(used)).toBe(SESSION_COLORS[5]);
  });
});
