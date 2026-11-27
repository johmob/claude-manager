// voice/download: download one file with size and sha256 checks. The fetch is injected (main passes
// Electron's net.fetch, which uses the system proxy and certificate store; tests pass a fake).
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/** An error whose message is already Swedish and fit to show the user. */
export class VoiceError extends Error {}

export interface DownloadOptions {
  url: string;
  dest: string;
  size: number;
  sha256: string;
  fetch: typeof fetch;
  /** Called with the number of new bytes as they arrive (a resumed part counts once, at the start). */
  onBytes(n: number): void;
  signal?: AbortSignal;
}

const HTML_BLOCKED = 'Hämtningen stoppades av nätverket: fick en webbsida i stället för filen.';

function looksLikeHtml(chunk: Uint8Array): boolean {
  let i = 0;
  while (i < chunk.length && (chunk[i] === 0x20 || chunk[i] === 0x0a || chunk[i] === 0x0d || chunk[i] === 0x09 || chunk[i] === 0xef || chunk[i] === 0xbb || chunk[i] === 0xbf)) i++;
  return chunk[i] === 0x3c; // '<'
}

function hashFile(path: string, hash: ReturnType<typeof createHash>): Promise<void> {
  return new Promise((resolve, reject) => {
    createReadStream(path).on('data', (d) => hash.update(d)).on('end', () => resolve()).on('error', reject);
  });
}

/**
 * Streams to `dest + '.part'` while hashing, and renames to `dest` only when size and hash both match.
 * A failed transfer keeps the `.part` for a retry (resumed with a Range request); a corrupt one is deleted.
 */
export async function downloadVerified(opts: DownloadOptions): Promise<void> {
  const { url, dest, size, sha256, onBytes, signal } = opts;
  const part = dest + '.part';
  await mkdir(dirname(dest), { recursive: true });

  const hash = createHash('sha256');
  let have = 0;
  if (existsSync(part)) {
    have = statSync(part).size;
    if (have >= size) {
      await rm(part, { force: true });
      have = 0;
    }
  }
  if (have > 0) await hashFile(part, hash);

  let res: Response;
  try {
    res = await opts.fetch(url, { signal, headers: have > 0 ? { Range: `bytes=${have}-` } : undefined });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new VoiceError(`Hämtningen misslyckades: ingen kontakt (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (!res.ok) throw new VoiceError(`Hämtningen misslyckades: servern svarade ${res.status}.`);
  if (!res.body) throw new VoiceError('Hämtningen misslyckades: svaret saknade innehåll.');

  // A server that ignores the Range header sends the whole file: start over.
  const append = have > 0 && res.status === 206;
  const h = append ? hash : createHash('sha256');
  if (append) onBytes(have);

  const out = createWriteStream(part, { flags: append ? 'a' : 'w' });
  let written = append ? have : 0;
  let first = true;
  const outDone = new Promise<void>((resolve, reject) => {
    out.on('close', () => resolve());
    out.on('error', reject);
  });
  outDone.catch(() => {});
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (first) {
        first = false;
        if (!append && looksLikeHtml(value)) {
          await reader.cancel().catch(() => {});
          throw new VoiceError(HTML_BLOCKED);
        }
      }
      h.update(value);
      written += value.length;
      if (!out.write(value)) await Promise.race([new Promise<void>((r) => out.once('drain', () => r())), outDone]);
      onBytes(value.length);
      if (written > size) break;
    }
    out.end();
    await outDone;
  } catch (e) {
    if (!out.closed) await new Promise<void>((r) => { out.once('close', () => r()); out.destroy(); });
    if (signal?.aborted) throw e; // cancelled: the part stays for a retry
    if (e instanceof VoiceError) {
      await rm(part, { force: true });
      throw e;
    }
    throw new VoiceError(`Hämtningen avbröts: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (written !== size) {
    await rm(part, { force: true });
    throw new VoiceError(`Hämtningen blev fel storlek (${written} av ${size} byte).`);
  }
  if (h.digest('hex') !== sha256) {
    await rm(part, { force: true });
    throw new VoiceError('Hämtningen blev skadad: kontrollsumman stämmer inte.');
  }
  await rm(dest, { force: true });
  await rename(part, dest);
}
