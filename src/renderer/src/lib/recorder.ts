// Browser-only microphone recording that stops by itself when the user falls silent.
import { createSilenceDetector } from './silence';
import { encodeWav16, padToMinLength, resampleLinear, rms } from './wav';

export interface Recording {
  /** Resolves with the WAV, or null when cancelled / no speech. Rejects with a Swedish message on mic errors. */
  done: Promise<{ wav: Uint8Array; ms: number } | null>;
  cancel(): void;
}

const TARGET_RATE = 16000;
const LEAD_MS = 200;
const TAIL_MS = 300;

let active: Recording | null = null;

function micError(e: unknown): Error {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return new Error('Mikrofonen är avstängd i Windows inställningar (Sekretess > Mikrofon).');
  if (name === 'NotReadableError' || name === 'AbortError') return new Error('Mikrofonen används av något annat program.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new Error('Ingen mikrofon hittades.');
  return new Error('Kunde inte starta mikrofonen.');
}

export function startRecording(opts: {
  silenceMs: number;
  onLevel?(level: number): void;
  onPhase?(phase: 'waiting' | 'speaking' | 'trailing'): void;
}): Recording {
  active?.cancel();

  let cancelled = false;
  let finish: (() => void) | null = null;
  let stopNow = false;

  const rec: Recording = {
    done: null as unknown as Recording['done'],
    cancel() {
      cancelled = true;
      finish?.();
      if (!finish) stopNow = true;
    },
  };

  rec.done = (async () => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let node: ScriptProcessorNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        throw micError(e);
      }
      if (cancelled || stopNow) return null;

      try {
        ctx = new AudioContext({ sampleRate: TARGET_RATE });
      } catch {
        ctx = new AudioContext();
      }
      const rate = ctx.sampleRate;
      source = ctx.createMediaStreamSource(stream);
      node = ctx.createScriptProcessor(2048, 1, 1);

      const frames: Float32Array[] = [];
      const frameStart: number[] = []; // sample index where each frame starts
      let total = 0;
      let speechStartSample = -1;
      let lastLoudEnd = 0; // sample index after the last frame that was speech-or-trailing-loud
      const detector = createSilenceDetector({ silenceMs: opts.silenceMs });
      let lastPhase = '';
      let lastLevelAt = 0;
      const startedAt = performance.now();
      let outcome: string = '';

      const stopped = new Promise<void>((resolve) => {
        finish = resolve;
      });

      node.onaudioprocess = (ev) => {
        if (outcome) return;
        const data = ev.inputBuffer.getChannelData(0);
        const copy = new Float32Array(data); // the buffer is reused by the engine
        frames.push(copy);
        frameStart.push(total);
        total += copy.length;
        const level = rms(copy);
        const now = performance.now();
        if (opts.onLevel && now - lastLevelAt >= 50) {
          lastLevelAt = now;
          opts.onLevel(Math.min(1, level * 6));
        }
        const o = detector.feed(level, now - startedAt);
        if (o === 'waiting' || o === 'speaking' || o === 'trailing') {
          if (o !== lastPhase) {
            lastPhase = o;
            opts.onPhase?.(o);
          }
          if (o === 'speaking') {
            if (speechStartSample < 0) speechStartSample = frameStart[Math.max(0, frames.length - 4)];
            lastLoudEnd = total;
          }
        } else if (o === 'stop' || o === 'max') {
          outcome = o;
          finish?.();
        } else if (o === 'no-speech') {
          outcome = o;
          finish?.();
        }
      };

      source.connect(node);
      node.connect(ctx.destination); // required for onaudioprocess to fire in Chromium; the output is silent

      if (cancelled || stopNow) return null;
      await stopped;
      if (cancelled || outcome === 'no-speech' || speechStartSample < 0) return null;

      const all = new Float32Array(total);
      let o = 0;
      for (const f of frames) {
        all.set(f, o);
        o += f.length;
      }
      const lead = Math.round((LEAD_MS / 1000) * rate);
      const tail = Math.round((TAIL_MS / 1000) * rate);
      const from = Math.max(0, speechStartSample - lead);
      const to = Math.min(total, lastLoudEnd + tail);
      let samples: Float32Array = all.subarray(from, Math.max(from + 1, to));
      if (rate !== TARGET_RATE) samples = resampleLinear(samples, rate, TARGET_RATE);
      samples = padToMinLength(samples, TARGET_RATE); // at least 1 s for whisper
      return { wav: encodeWav16(samples, TARGET_RATE), ms: Math.round((samples.length / TARGET_RATE) * 1000) };
    } finally {
      if (node) {
        node.onaudioprocess = null;
        try {
          node.disconnect();
        } catch {
          /* already disconnected */
        }
      }
      try {
        source?.disconnect();
      } catch {
        /* already disconnected */
      }
      stream?.getTracks().forEach((t) => t.stop());
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
      if (active === rec) active = null;
    }
  })();

  active = rec;
  return rec;
}
