// file-actions: what the user can do with a file an agent links to: save a copy, copy it to the clipboard,
// start a new mail with it attached (classic Outlook).
import { ClipboardItem, app, clipboard, dialog, nativeImage, type BrowserWindow } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

/** Save as…: asks where, then copies the file there. Does nothing if the dialog is cancelled. */
export async function saveCopyAs(path: string, parent?: BrowserWindow | null): Promise<void> {
  const options = { defaultPath: join(app.getPath('downloads'), basename(path)) };
  const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return;
  await copyFile(path, result.filePath);
}

const CLIPBOARD_IMAGES = new Set(['.png', '.jpg', '.jpeg', '.bmp']);

/** Puts the file on the clipboard: pixels for an image, otherwise the file itself (pastes into Teams, Outlook, Explorer). */
export async function copyToClipboard(path: string): Promise<void> {
  if (CLIPBOARD_IMAGES.has(extname(path).toLowerCase())) {
    const image = nativeImage.createFromPath(path);
    if (!image.isEmpty()) {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]);
      return;
    }
  }
  await new Promise<void>((done, fail) => {
    // The path goes in an environment variable, never into the command text.
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -LiteralPath $env:CM_FILE'],
      { env: { ...process.env, CM_FILE: path }, windowsHide: true },
      (error) => (error ? fail(error) : done()),
    );
  });
}

/** The default value in `reg query` output, or null. */
export function parseRegDefault(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(?:\(Default\)|\(Standard\)|<NO NAME>)\s+REG_SZ\s+(.+?)\s*$/i.exec(line);
    if (m?.[1]) return m[1].replace(/^"(.*)"$/, '$1');
  }
  return null;
}

let outlook: Promise<string | null> | null = null;

/** Where classic Outlook is installed, or null (new Outlook cannot take a file on the command line). Cached. */
export function outlookPath(): Promise<string | null> {
  outlook ??= new Promise<string | null>((done) => {
    execFile('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\OUTLOOK.EXE', '/ve'], { windowsHide: true }, (error, stdout) => {
      const found = error ? null : parseRegDefault(stdout);
      done(found && existsSync(found) ? found : null);
    });
  });
  return outlook;
}

/** A new mail in classic Outlook with the file attached. */
export async function mailWithAttachment(path: string): Promise<void> {
  const exe = await outlookPath();
  if (!exe) throw new Error('Outlook hittades inte.');
  spawn(exe, ['/a', path], { detached: true, stdio: 'ignore' }).unref();
}
