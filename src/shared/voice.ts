// Voice input: types and constants shared by main and renderer. No behaviour beyond tiny pure helpers.

export const VOICE_SILENCE_MIN = 1;
export const VOICE_SILENCE_MAX = 5;
export const VOICE_SILENCE_DEFAULT = 2;

/** Clamps a silence length in seconds to 1–5 in steps of 0.5; anything invalid gives the default. */
export function clampSilence(s: unknown): number {
  if (typeof s !== 'number' || !Number.isFinite(s)) return VOICE_SILENCE_DEFAULT;
  return Math.min(VOICE_SILENCE_MAX, Math.max(VOICE_SILENCE_MIN, Math.round(s * 2) / 2));
}

/** Whether speech-to-text can run, and the first-use download. */
export interface VoiceStatus {
  state: 'missing' | 'downloading' | 'ready' | 'error';
  /** 0–100 over binary and model together while downloading. */
  progress: number;
  /** Total bytes still to fetch when missing/downloading (for "≈ 185 MB"). */
  totalBytes: number;
  /** Why it failed, in Swedish, when state is "error". */
  message: string;
}

export interface VoiceTranscribeRequest {
  /** 16 kHz mono 16-bit PCM WAV file bytes. */
  wav: Uint8Array;
}

export interface VoiceTranscribeResult {
  text: string;
  /** Milliseconds whisper took, for the log and tuning. */
  ms: number;
}

export interface VoiceCleanRequest {
  text: string;
}
