import { describe, expect, it } from 'vitest';
import { createSilenceDetector, type SilenceOutcome } from './silence';

const STEP = 50;

/** Feeds a level pattern: [level, durationMs] segments. Returns the outcomes with their times. */
function run(
  segments: [number, number][],
  opts: Parameters<typeof createSilenceDetector>[0] = { silenceMs: 1000 },
): { t: number; o: SilenceOutcome }[] {
  const d = createSilenceDetector(opts);
  const out: { t: number; o: SilenceOutcome }[] = [];
  let t = 0;
  for (const [level, dur] of segments) {
    for (let e = 0; e < dur; e += STEP) {
      out.push({ t, o: d.feed(level, t) });
      t += STEP;
    }
  }
  return out;
}

const first = (r: { t: number; o: SilenceOutcome }[], o: SilenceOutcome) => r.find((x) => x.o === o);

describe('silence detector', () => {
  it('calibrates first, then waits', () => {
    const r = run([[0.002, 1000]]);
    expect(r[0].o).toBe('calibrating');
    expect(r[r.length - 1].o).toBe('waiting');
  });

  it('stops after speech followed by enough silence', () => {
    const r = run([[0.002, 500], [0.1, 1000], [0.002, 3000]]);
    expect(first(r, 'speaking')).toBeTruthy();
    expect(first(r, 'trailing')).toBeTruthy();
    const stop = first(r, 'stop')!;
    expect(stop.t).toBeGreaterThanOrEqual(1500 + 1000 - STEP);
    expect(stop.t).toBeLessThanOrEqual(1500 + 1000 + 2 * STEP);
  });

  it('does not stop during a pause shorter than silenceMs', () => {
    const r = run([[0.002, 500], [0.1, 500], [0.002, 600], [0.1, 500], [0.002, 400]]);
    expect(first(r, 'stop')).toBeUndefined();
    expect(r.filter((x) => x.o === 'speaking').length).toBeGreaterThan(10);
  });

  it('does not count a short click as speech', () => {
    const r = run([[0.002, 500], [0.3, 100], [0.002, 9000]], { silenceMs: 1000, noSpeechMs: 5000 });
    expect(first(r, 'speaking')).toBeUndefined();
    expect(first(r, 'stop')).toBeUndefined();
    expect(first(r, 'no-speech')).toBeTruthy();
  });

  it('reports no-speech when nothing is said', () => {
    const r = run([[0.002, 9000]], { silenceMs: 1000, noSpeechMs: 8000 });
    const ns = first(r, 'no-speech')!;
    expect(ns.t).toBeGreaterThanOrEqual(8000);
    expect(ns.t).toBeLessThan(8200);
  });

  it('caps the recording at maxMs', () => {
    const r = run([[0.002, 300], [0.1, 5000]], { silenceMs: 1000, maxMs: 2000 });
    const m = first(r, 'max')!;
    expect(m.t).toBe(2000);
  });

  it('adapts the threshold to a noisy room', () => {
    // Constant noise of 0.02 is not speech: threshold is 3x the floor.
    const r = run([[0.02, 3000]], { silenceMs: 1000, noSpeechMs: 2500 });
    expect(first(r, 'speaking')).toBeUndefined();
    expect(first(r, 'no-speech')).toBeTruthy();
  });

  it('uses hysteresis: a level between release and speech threshold keeps speaking', () => {
    // floor 0.002 -> speech 0.012, release 0.008. 0.01 sits in between.
    const r = run([[0.002, 400], [0.1, 400], [0.01, 2000]]);
    expect(first(r, 'trailing')).toBeUndefined();
    expect(first(r, 'stop')).toBeUndefined();
    expect(r[r.length - 1].o).toBe('speaking');
  });

  it('does not start speech from a level only between the thresholds', () => {
    const r = run([[0.002, 400], [0.01, 1000]]);
    expect(first(r, 'speaking')).toBeUndefined();
  });
});
