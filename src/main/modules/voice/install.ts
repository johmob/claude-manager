// voice/install: unpack the whisper.cpp zip. Windows ships bsdtar (reads zip) as tar.exe, so no npm dependency;
// Expand-Archive in PowerShell is the fallback. The zip has a top folder `Release/` with the cli and all DLLs.
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Runs a program to completion; rejects when it fails. execFile wrapper in production, a fake in tests. */
export type Run = (file: string, args: string[], opts?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<void>;

function systemExe(...parts: string[]): string {
  return join(process.env.SystemRoot ?? 'C:\Windows', 'System32', ...parts);
}

async function unzip(zip: string, into: string, run: Run): Promise<void> {
  const tar = systemExe('tar.exe');
  try {
    if (!existsSync(tar)) throw new Error('tar.exe saknas');
    await run(tar, ['-xf', zip, '-C', into], { timeoutMs: 120_000 });
  } catch {
    const quote = (p: string): string => `'${p.replace(/'/g, "''")}'`;
    await run(
      systemExe('WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(into)} -Force`],
      { timeoutMs: 120_000 },
    );
  }
}

/**
 * Unpacks `zip` and puts the contents of its `Release/` folder (or the zip root, if there is none) in `destDir`.
 * Works in a sibling scratch folder and renames at the end, so `destDir` only ever exists complete.
 */
export async function extractZip(zip: string, destDir: string, run: Run): Promise<void> {
  const scratch = destDir + '.extract';
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  try {
    await unzip(zip, scratch, run);
    const release = join(scratch, 'Release');
    const source = existsSync(release) ? release : scratch;
    if ((await readdir(source)).length === 0) throw new Error('Zip-filen var tom.');
    await mkdir(dirname(destDir), { recursive: true });
    await rm(destDir, { recursive: true, force: true });
    await rename(source, destDir);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
