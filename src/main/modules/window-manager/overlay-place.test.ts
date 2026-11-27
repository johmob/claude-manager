import { describe, expect, it } from 'vitest';
import { overlaySuppressed, snapZone, snappedPosition } from './overlay-place';

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const base = { mainVisible: true, minimized: false, maximized: true, fullscreen: false, sameDisplay: true, appFocused: true };

describe('snapZone', () => {
  it('snaps near the top middle', () => {
    expect(snapZone({ x: 700, y: 30, width: 520, height: 112 }, area)).toBe('top');
  });
  it('does not snap at the top far from the middle', () => {
    expect(snapZone({ x: 100, y: 10, width: 520, height: 112 }, area)).toBeNull();
  });
  it('snaps near the middle of the left and right edges', () => {
    expect(snapZone({ x: 20, y: 480, width: 520, height: 112 }, area)).toBe('left');
    expect(snapZone({ x: 1920 - 520 - 10, y: 450, width: 520, height: 112 }, area)).toBe('right');
  });
  it('leaves free places alone', () => {
    expect(snapZone({ x: 600, y: 400, width: 520, height: 112 }, area)).toBeNull();
    expect(snapZone({ x: 20, y: 900, width: 520, height: 112 }, area)).toBeNull();
  });
});

describe('snappedPosition', () => {
  it('centres at the top', () => {
    expect(snappedPosition('top', area, 520, 112)).toEqual({ x: 700, y: 2 });
  });
  it('sits at the side with a margin, centred vertically', () => {
    expect(snappedPosition('left', area, 520, 112)).toEqual({ x: 8, y: 464 });
    expect(snappedPosition('right', area, 520, 112)).toEqual({ x: 1392, y: 464 });
  });
  it('is clamped so an open detail panel fits', () => {
    const p = snappedPosition('left', area, 430, 552, 112);
    expect(p.y + 552).toBeLessThanOrEqual(1040);
  });
});

describe('overlaySuppressed', () => {
  it('hides over a maximised, focused app', () => {
    expect(overlaySuppressed(base)).toBe(true);
    expect(overlaySuppressed({ ...base, maximized: false, fullscreen: true })).toBe(true);
  });
  it('shows when the app is not full screen, minimised, hidden or covered', () => {
    expect(overlaySuppressed({ ...base, maximized: false })).toBe(false);
    expect(overlaySuppressed({ ...base, minimized: true })).toBe(false);
    expect(overlaySuppressed({ ...base, mainVisible: false })).toBe(false);
    expect(overlaySuppressed({ ...base, appFocused: false })).toBe(false);
    expect(overlaySuppressed({ ...base, sameDisplay: false })).toBe(false);
  });
});
