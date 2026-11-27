// voice: local speech-to-text with whisper.cpp and KBLab's Swedish model. Owns the first-use download,
// the install and the transcription; it knows nothing about sessions or settings. No audio leaves the computer.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { VoiceStatus, VoiceTranscribeResult } from '../../../shared/voice';
import { DEFAULT_MODEL, VOICE_MODELS, WHISPER_ZIP, voicePaths, type VoiceModelName } from './assets';
import { downloadVerified, VoiceError } from './download';
import { extractZip, type Run } from './install';
import { runWhisper } from './transcribe';

export interface Voice {
  status(): VoiceStatus;
  /** Starts the first-use download if needed. Idempotent: a running download returns the same promise. Never rejects; failure becomes state "error". */
  prepare(): Promise<void>;
  /** Rejects with a Swedish message on failure. One whisper at a time. */
  transcribe(wav: Uint8Array): Promise<VoiceTranscribeResult>;
  /** Cancels a download (the .part is kept) and kills a running whisper. */
  dispose(): void;
}

export interface VoiceOptions {
  dir: string;
  fetch: typeof fetch;
  onStatus(s: VoiceStatus): void;
  log?(msg: string): void;
  model?: VoiceModelName;
  /** Replaces the real process runner (tests). */
  run?: Run;
}

/** 16 kHz x 16 bit x 120 s, plus a WAV header. */
export const MAX_WAV_BYTES = 16000 * 2 * 120 + 44;
const STATUS_INTERVAL_MS = 250;

const defaultRun: Run = (file, args, opts) =>
  new Promise<void>((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: opts?.timeoutMs, signal: opts?.signal, maxBuffer: 8 * 1024 * 1024 }, (err, _out, stderr) => {
      if (!err) return resolve();
      const e = err as NodeJS.ErrnoException & { killed?: boolean };
      const tail = String(stderr ?? '').trim().split(/\r?\n/).slice(-3).join(' | ');
      reject(Object.assign(new Error(tail ? `${e.message} ${tail}` : e.message), { code: e.code, killed: e.killed, name: e.name }));
    });
  });

export function createVoice(opts: VoiceOptions): Voice {
  const modelName = opts.model ?? DEFAULT_MODEL;
  const model = VOICE_MODELS[modelName];
  const paths = voicePaths(opts.dir, modelName);
  const run = opts.run ?? defaultRun;
  const log = opts.log ?? (() => {});

  const have = (): { cli: boolean; model: boolean } => ({ cli: existsSync(paths.cli), model: existsSync(paths.model) });
  const missingBytes = (): number => {
    const h = have();
    return (h.cli ? 0 : WHISPER_ZIP.size) + (h.model ? 0 : model.size);
  };

  // Leftovers of a crash: temp recordings. (The zip's .part in the same folder is kept for a retry.)
  try {
    for (const f of readdirSync(paths.tmp)) if (f.startsWith('rec-')) rmSync(join(paths.tmp, f), { force: true });
  } catch {
    /* no tmp folder yet */
  }

  const initial = (): VoiceStatus => {
    const missing = missingBytes();
    return missing === 0 ? { state: 'ready', progress: 100, totalBytes: 0, message: '' } : { state: 'missing', progress: 0, totalBytes: missing, message: '' };
  };
  let current: VoiceStatus = initial();
  let lastEmit = 0;
  const set = (s: VoiceStatus, throttle = false): void => {
    current = s;
    const now = Date.now();
    if (throttle && now - lastEmit < STATUS_INTERVAL_MS) return;
    lastEmit = now;
    opts.onStatus(s);
  };

  let preparing: Promise<void> | null = null;
  let downloadAbort: AbortController | null = null;
  let running: AbortController | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;

  async function install(signal: AbortSignal): Promise<void> {
    const h = have();
    const total = (h.cli ? 0 : WHISPER_ZIP.size) + (h.model ? 0 : model.size);
    let done = 0;
    const progress = (): void => set({ state: 'downloading', progress: Math.min(99, Math.floor((done / total) * 100)), totalBytes: total, message: '' }, true);
    set({ state: 'downloading', progress: 0, totalBytes: total, message: '' });
    const get = (a: { url: string; size: number; sha256: string }, dest: string): Promise<void> =>
      downloadVerified({ ...a, dest, fetch: opts.fetch, signal, onBytes: (n) => { done += n; progress(); } });

    if (!h.cli) {
      const zip = join(paths.tmp, `whisper-${WHISPER_ZIP.tag}.zip`);
      await get(WHISPER_ZIP, zip);
      await extractZip(zip, paths.binDir, run);
      await rm(zip, { force: true });
      if (!existsSync(paths.cli)) throw new VoiceError('Röstmotorn packades upp, men whisper-cli.exe saknas.');
      // Older whisper builds are not needed once this one is in place.
      const root = dirname(paths.binDir);
      for (const f of readdirSync(root)) if (f.startsWith('whisper-') && f !== basename(paths.binDir)) await rm(join(root, f), { recursive: true, force: true });
    }
    if (!h.model) await get(model, paths.model);
  }

  function prepare(): Promise<void> {
    if (preparing) return preparing;
    if (missingBytes() === 0) {
      if (current.state !== 'ready') set(initial());
      return Promise.resolve();
    }
    downloadAbort = new AbortController();
    preparing = install(downloadAbort.signal)
      .then(() => {
        set({ state: 'ready', progress: 100, totalBytes: 0, message: '' });
        log('voice: installed');
      })
      .catch((e: unknown) => {
        if (disposed) return;
        const message = e instanceof VoiceError ? e.message : `Hämtningen misslyckades: ${e instanceof Error ? e.message : String(e)}`;
        log(`voice: install failed: ${message}`);
        set({ state: 'error', progress: 0, totalBytes: missingBytes(), message });
      })
      .finally(() => {
        preparing = null;
        downloadAbort = null;
      });
    return preparing;
  }

  function transcribe(wav: Uint8Array): Promise<VoiceTranscribeResult> {
    if (!existsSync(paths.cli) || !existsSync(paths.model)) {
      if (current.state === 'ready') set(initial());
      return Promise.reject(new VoiceError('Röstinmatningen är inte installerad än.'));
    }
    if (wav.length <= 44) return Promise.reject(new VoiceError('Inspelningen var tom.'));
    if (wav.length > MAX_WAV_BYTES) return Promise.reject(new VoiceError('Inspelningen är för lång (högst 2 minuter).'));
    const job = queue.then(async (): Promise<VoiceTranscribeResult> => {
      if (disposed) throw new VoiceError('Röstinmatningen stängdes.');
      const started = Date.now();
      running = new AbortController();
      try {
        const text = await runWhisper(paths, wav, run, running.signal);
        return { text, ms: Date.now() - started };
      } catch (e) {
        if (e instanceof VoiceError) throw e;
        const err = e as NodeJS.ErrnoException & { killed?: boolean };
        log(`voice: whisper failed: ${err.message}`);
        if (disposed) throw new VoiceError('Röstinmatningen stängdes.');
        if (err.code === 'ENOENT') throw new VoiceError('Röstmotorn kunde inte startas. Ett antivirusprogram kan ha tagit bort den.');
        if (err.killed) throw new VoiceError('Transkriberingen tog för lång tid.');
        throw new VoiceError('Transkriberingen misslyckades.');
      } finally {
        running = null;
      }
    });
    queue = job.catch(() => {});
    return job;
  }

  return {
    status: () => current,
    prepare,
    transcribe,
    dispose() {
      disposed = true;
      downloadAbort?.abort();
      running?.abort();
    },
  };
}
