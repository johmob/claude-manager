// voice/transcribe: run whisper.cpp on one recording. The result is read from a UTF-8 txt file, because
// stdout encoding on Windows is not reliable for å, ä and ö.
import { availableParallelism } from 'node:os';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VoicePaths } from './assets';
import type { Run } from './install';

export function whisperThreads(): number {
  return Math.max(2, Math.min(8, availableParallelism() - 2));
}

export function whisperArgs(o: { model: string; wav: string; outBase: string; threads: number; prompt?: string }): string[] {
  const args = ['-m', o.model, '-f', o.wav, '-l', 'sv', '-nt', '-np', '-otxt', '-of', o.outBase, '-t', String(o.threads)];
  if (o.prompt) args.push('--prompt', o.prompt);
  return args;
}

/** A line that is only a marker such as [BLANK_AUDIO], [MUSIK], (musik) or [Tystnad]. */
const MARKER_LINE = /^\s*(\[[^\]]*\]|\([^)]*\))\s*$/;

/** What whisper tends to invent on near-silence (YouTube outros and subtitle credits). Dropped only when it is everything. */
const HALLUCINATIONS = [
  /^tack för (att (ni|du) (tittade|lyssnade|tittat|lyssnat)|titten|lyssnandet)( på( detta| den här)?( videon| filmen| programmet)?)?[.!\s]*$/i,
  /^(textning|textad|undertexter|undertextning|översättning|översatt)(?![a-zåäö]).{0,60}$/i,
  /^text av(?![a-zåäö]).{0,60}$/i,
  /^vi ses i nästa (video|avsnitt|film)[.!\s]*$/i,
  /^(prenumerera|glöm inte att (prenumerera|gilla)).{0,60}$/i,
];

/** Joins lines, drops non-speech markers and lone hallucinations, collapses whitespace. */
export function cleanTranscript(raw: string): string {
  const text = raw
    .split(/\r?\n/)
    .filter((l) => !MARKER_LINE.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text && HALLUCINATIONS.some((re) => re.test(text))) return '';
  return text;
}

/** Writes the temp WAV, runs whisper-cli (hidden, 60 s limit), reads the text and deletes both temp files. */
export async function runWhisper(paths: VoicePaths, wav: Uint8Array, run: Run, signal?: AbortSignal): Promise<string> {
  await mkdir(paths.tmp, { recursive: true });
  const outBase = join(paths.tmp, `rec-${randomBytes(6).toString('hex')}`);
  const wavPath = outBase + '.wav';
  const txtPath = outBase + '.txt';
  try {
    await writeFile(wavPath, wav);
    await run(paths.cli, whisperArgs({ model: paths.model, wav: wavPath, outBase, threads: whisperThreads() }), { timeoutMs: 60_000, signal });
    return cleanTranscript(await readFile(txtPath, 'utf8'));
  } finally {
    await Promise.all([rm(wavPath, { force: true }), rm(txtPath, { force: true })]);
  }
}
