// Decides from audio levels when the user has finished speaking. Pure: the caller feeds RMS levels with timestamps.

export type SilenceOutcome = 'calibrating' | 'waiting' | 'speaking' | 'trailing' | 'stop' | 'no-speech' | 'max';

export interface SilenceOptions {
  silenceMs: number;
  calibrateMs?: number;
  noSpeechMs?: number;
  maxMs?: number;
}

// Audio frames arrive about 128 ms apart (2048 samples at 16 kHz), so 150 ms needed three loud frames (~260 ms of
// speech) and a short word like "Två" never counted. 100 ms needs two frames; a single click still does not count.
const MIN_SPEECH_MS = 100;

export function createSilenceDetector(opts: SilenceOptions): { feed(level: number, tMs: number): SilenceOutcome } {
  const calibrateMs = opts.calibrateMs ?? 300;
  const noSpeechMs = opts.noSpeechMs ?? 8000;
  const maxMs = opts.maxMs ?? 90000;

  let t0: number | null = null;
  const calib: number[] = [];
  let floor = 0;
  let calibrated = false;
  /** When the level first rose above the speech threshold in the current burst. */
  let burstStart: number | null = null;
  let speechHeard = false;
  /** Last time the level was at or above the release threshold after speech. */
  let lastLoud = 0;
  let inSpeech = false;

  const median = (xs: number[]): number => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  return {
    feed(level, tMs) {
      if (t0 === null) t0 = tMs;
      const elapsed = tMs - t0;
      if (elapsed >= maxMs) return 'max';

      if (!calibrated) {
        calib.push(level);
        if (elapsed < calibrateMs) return 'calibrating';
        floor = median(calib);
        calibrated = true;
      }

      const speechThr = Math.max(0.012, floor * 3);
      const releaseThr = Math.max(0.008, floor * 2);

      if (inSpeech) {
        if (level >= releaseThr) lastLoud = tMs;
      } else {
        if (level >= speechThr || (burstStart !== null && level >= releaseThr)) {
          if (burstStart === null) burstStart = tMs;
          if (tMs - burstStart >= MIN_SPEECH_MS) {
            speechHeard = true;
            inSpeech = true;
            lastLoud = tMs;
          }
        } else {
          burstStart = null;
          // Follow slow changes in background noise while nobody speaks.
          floor = floor * 0.95 + level * 0.05;
        }
      }

      if (inSpeech) {
        if (level >= releaseThr) return 'speaking';
        // Below release after speech: trailing until the silence is long enough.
        return tMs - lastLoud >= opts.silenceMs ? 'stop' : 'trailing';
      }
      if (!speechHeard && elapsed >= noSpeechMs) return 'no-speech';
      return 'waiting';
    },
  };
}
