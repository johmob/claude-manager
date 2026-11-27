import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VOICE_MODELS, WHISPER_ZIP, voicePaths } from './assets';
import { downloadVerified } from './download';
import { createVoice, MAX_WAV_BYTES } from './index';
import { extractZip, type Run } from './install';
import { cleanTranscript, whisperArgs } from './transcribe';

let scratch = '';
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cm-voice-test-'));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

describe('whisperArgs', () => {
  it('asks for Swedish, plain text in a file and no timestamps', () => {
    expect(whisperArgs({ model: 'm.bin', wav: 'a.wav', outBase: 'out', threads: 4 })).toEqual(['-m', 'm.bin', '-f', 'a.wav', '-l', 'sv', '-nt', '-np', '-otxt', '-of', 'out', '-t', '4']);
    expect(whisperArgs({ model: 'm', wav: 'w', outBase: 'o', threads: 2, prompt: 'Hej' }).slice(-2)).toEqual(['--prompt', 'Hej']);
  });
});

describe('cleanTranscript', () => {
  it('joins lines and collapses whitespace', () => {
    expect(cleanTranscript(' Lägg till  en knapp.\n  Den ska spara filen.\r\n')).toBe('Lägg till en knapp. Den ska spara filen.');
  });
  it('removes non-speech markers on their own line', () => {
    expect(cleanTranscript('[BLANK_AUDIO]\n')).toBe('');
    expect(cleanTranscript(' [MUSIK]\n(musik)\n[Tystnad]\n')).toBe('');
    expect(cleanTranscript('[MUSIK]\nGör så här.\n(applåder)')).toBe('Gör så här.');
  });
  it('keeps brackets that are part of a sentence', () => {
    expect(cleanTranscript('Ändra funktionen (den gamla) nu.')).toBe('Ändra funktionen (den gamla) nu.');
  });
  it('drops a hallucination only when it is the whole transcript', () => {
    expect(cleanTranscript('Tack för att du tittade!')).toBe('');
    expect(cleanTranscript('Textning av Någon Namnsson')).toBe('');
    expect(cleanTranscript('Undertexter från en tjänst\n')).toBe('');
    expect(cleanTranscript('Fixa felet. Tack för att du tittade på det.')).toBe('Fixa felet. Tack för att du tittade på det.');
    expect(cleanTranscript('Texten ska vara röd.')).toBe('Texten ska vara röd.');
  });
});

function fakeFetch(body: Buffer | string, status = 200, onRequest?: (init?: RequestInit) => void): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    onRequest?.(init);
    const range = new Headers(init?.headers).get('Range');
    const buf = Buffer.from(body);
    if (range && status === 200) {
      const from = Number(/bytes=(\d+)-/.exec(range)![1]);
      return new Response(buf.subarray(from), { status: 206 });
    }
    return new Response(buf, { status });
  }) as typeof fetch;
}

describe('downloadVerified', () => {
  const data = Buffer.from('x'.repeat(5000) + 'end');

  it('writes the file when size and hash match, and reports bytes', async () => {
    const dest = join(scratch, 'sub', 'a.bin');
    let bytes = 0;
    await downloadVerified({ url: 'u', dest, size: data.length, sha256: sha(data), fetch: fakeFetch(data), onBytes: (n) => (bytes += n) });
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(dest + '.part')).toBe(false);
    expect(bytes).toBe(data.length);
  });

  it('rejects a hash mismatch and leaves no part and no file', async () => {
    const dest = join(scratch, 'a.bin');
    await expect(downloadVerified({ url: 'u', dest, size: data.length, sha256: 'ab'.repeat(32), fetch: fakeFetch(data), onBytes: () => {} })).rejects.toThrow(/kontrollsumman/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(dest + '.part')).toBe(false);
  });

  it('rejects a wrong size', async () => {
    const dest = join(scratch, 'a.bin');
    await expect(downloadVerified({ url: 'u', dest, size: data.length + 10, sha256: sha(data), fetch: fakeFetch(data), onBytes: () => {} })).rejects.toThrow(/fel storlek/);
    expect(existsSync(dest)).toBe(false);
  });

  it('says so plainly when a network filter sends a web page', async () => {
    const dest = join(scratch, 'a.bin');
    const html = '<!DOCTYPE html><html><body>Blocked by policy</body></html>';
    await expect(downloadVerified({ url: 'u', dest, size: 123456, sha256: sha(data), fetch: fakeFetch(html), onBytes: () => {} })).rejects.toThrow('Hämtningen stoppades av nätverket: fick en webbsida i stället för filen.');
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(dest + '.part')).toBe(false);
  });

  it('rejects a non-2xx status', async () => {
    await expect(downloadVerified({ url: 'u', dest: join(scratch, 'a.bin'), size: 1, sha256: 'x', fetch: fakeFetch('nope', 404), onBytes: () => {} })).rejects.toThrow(/404/);
  });

  it('resumes a kept part with a Range request', async () => {
    const dest = join(scratch, 'a.bin');
    writeFileSync(dest + '.part', data.subarray(0, 2000));
    let range: string | null = null;
    let bytes = 0;
    await downloadVerified({
      url: 'u', dest, size: data.length, sha256: sha(data),
      fetch: fakeFetch(data, 200, (init) => { range = new Headers(init?.headers).get('Range'); }),
      onBytes: (n) => (bytes += n),
    });
    expect(range).toBe('bytes=2000-');
    expect(bytes).toBe(data.length);
    expect(existsSync(dest)).toBe(true);
  });

  it('keeps the part when the transfer is cut off, for a retry', async () => {
    const dest = join(scratch, 'a.bin');
    const cut = (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(data.subarray(0, 1000)));
            c.error(new Error('reset'));
          },
        }),
      )) as unknown as typeof fetch;
    await expect(downloadVerified({ url: 'u', dest, size: data.length, sha256: sha(data), fetch: cut, onBytes: () => {} })).rejects.toThrow(/avbröts/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(dest + '.part')).toBe(true);
  });
});

describe('extractZip', () => {
  it('moves the Release folder to the destination and cleans up', async () => {
    const run: Run = async (_file, args) => {
      const into = args[args.indexOf('-C') + 1] ?? args.join(' ');
      if (!args.includes('-C')) throw new Error('unexpected');
      mkdirSync(join(into, 'Release'), { recursive: true });
      writeFileSync(join(into, 'Release', 'whisper-cli.exe'), 'x');
      writeFileSync(join(into, 'Release', 'ggml-cpu-haswell.dll'), 'x');
    };
    const dest = join(scratch, 'bin');
    await extractZip(join(scratch, 'z.zip'), dest, run);
    expect(readdirSync(dest).sort()).toEqual(['ggml-cpu-haswell.dll', 'whisper-cli.exe']);
    expect(existsSync(dest + '.extract')).toBe(false);
  });

  it('leaves no destination when unpacking fails', async () => {
    const run: Run = async () => {
      throw new Error('broken');
    };
    const dest = join(scratch, 'bin');
    await expect(extractZip(join(scratch, 'z.zip'), dest, run)).rejects.toThrow();
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(dest + '.extract')).toBe(false);
  });
});

describe('createVoice', () => {
  const noFetch = (() => Promise.reject(new Error('no network in test'))) as unknown as typeof fetch;

  it('is missing on an empty folder, with the bytes still to fetch', () => {
    const v = createVoice({ dir: scratch, fetch: noFetch, onStatus: () => {} });
    expect(v.status()).toEqual({ state: 'missing', progress: 0, totalBytes: WHISPER_ZIP.size + VOICE_MODELS.small.size, message: '' });
  });

  function install(): ReturnType<typeof voicePaths> {
    const p = voicePaths(scratch);
    mkdirSync(p.binDir, { recursive: true });
    mkdirSync(join(p.model, '..'), { recursive: true });
    writeFileSync(p.cli, 'x');
    writeFileSync(p.model, 'x');
    return p;
  }

  it('is ready when the cli and the model are on disk', () => {
    install();
    const v = createVoice({ dir: scratch, fetch: noFetch, onStatus: () => {} });
    expect(v.status()).toMatchObject({ state: 'ready', progress: 100, totalBytes: 0 });
  });

  it('turns a failed download into state error with a Swedish message', async () => {
    const seen: string[] = [];
    const v = createVoice({ dir: scratch, fetch: noFetch, onStatus: (s) => seen.push(s.state) });
    await v.prepare();
    expect(v.status().state).toBe('error');
    expect(v.status().message).toMatch(/^Hämtningen misslyckades/);
    expect(seen).toContain('downloading');
  });

  it('shares one promise while preparing', async () => {
    const v = createVoice({ dir: scratch, fetch: noFetch, onStatus: () => {} });
    expect(v.prepare()).toBe(v.prepare());
    await v.prepare();
  });

  it('refuses to transcribe when not installed, and rejects empty or long recordings', async () => {
    const v = createVoice({ dir: scratch, fetch: noFetch, onStatus: () => {} });
    await expect(v.transcribe(new Uint8Array(1000))).rejects.toThrow('Röstinmatningen är inte installerad än.');
    install();
    await expect(v.transcribe(new Uint8Array(10))).rejects.toThrow(/tom/);
    await expect(v.transcribe(new Uint8Array(MAX_WAV_BYTES + 1))).rejects.toThrow(/för lång/);
  });

  it('transcribes through the runner, one at a time, and deletes the temp files', async () => {
    const p = install();
    let active = 0;
    let maxActive = 0;
    const run: Run = async (_file, args) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const outBase = args[args.indexOf('-of') + 1];
      expect(existsSync(args[args.indexOf('-f') + 1])).toBe(true);
      await new Promise((r) => setTimeout(r, 20));
      writeFileSync(outBase + '.txt', ' [MUSIK]\n Hej på dig.\n', 'utf8');
      active--;
    };
    const v = createVoice({ dir: scratch, fetch: noFetch, onStatus: () => {}, run });
    const [a, b] = await Promise.all([v.transcribe(new Uint8Array(1000)), v.transcribe(new Uint8Array(1000))]);
    expect(a.text).toBe('Hej på dig.');
    expect(b.text).toBe('Hej på dig.');
    expect(a.ms).toBeGreaterThanOrEqual(0);
    expect(maxActive).toBe(1);
    expect(readdirSync(p.tmp)).toEqual([]);
  });

  it('maps a failing runner to a Swedish message and still deletes the temp files', async () => {
    const p = install();
    const run: Run = async () => {
      throw Object.assign(new Error('exit 3'), { code: 3 });
    };
    const v = createVoice({ dir: scratch, fetch: noFetch, onStatus: () => {}, run });
    await expect(v.transcribe(new Uint8Array(1000))).rejects.toThrow('Transkriberingen misslyckades.');
    expect(readdirSync(p.tmp)).toEqual([]);
  });
});
