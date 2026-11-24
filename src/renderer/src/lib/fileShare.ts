import { useEffect, useState } from 'react';

export type FileAction = 'save-as' | 'copy' | 'mail' | 'show';

/** Runs a file action on the computer (desktop only). */
export function fileAct(path: string, action: FileAction): Promise<void> {
  // main reads the target like a link target: percent-encoded.
  return window.cm.invoke('file:act', { target: encodeURIComponent(path), action });
}

/** Opens the file with its Windows program (desktop only). */
export function openFile(path: string): void {
  window.cm.invoke('shell:open', { target: encodeURIComponent(path) }).catch((e: unknown) => console.error('shell:open', e));
}

let outlookKnown: Promise<boolean> | null = null;

/** True when classic Outlook exists on the computer (asked once). Always false on the phone. */
export function useOutlook(): boolean {
  const [found, setFound] = useState(false);
  useEffect(() => {
    let alive = true;
    outlookKnown ??= window.cm.invoke('file:outlook', undefined).catch(() => false);
    void outlookKnown.then((v) => alive && setFound(v));
    return () => {
      alive = false;
    };
  }, []);
  return found;
}

/** What the phone is told when the route refuses. */
export function fetchErrorText(status: number): string {
  if (status === 403) return 'Filen ligger utanför projekten eller är av en typ som inte delas.';
  if (status === 404) return 'Filen finns inte, eller är för stor.';
  return `Hämtningen misslyckades (${status}).`;
}

/** Fetches a file from the computer as a File the phone can save or share. */
export async function fetchShareable(url: string, name: string): Promise<File> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(fetchErrorText(res.status));
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}

/** True when this browser can hand files to the share menu at all. */
export function canShareFiles(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
}

/** Opens the phone's share menu with the file. False when it cannot be shared or the user backed out. */
export async function shareFile(file: File): Promise<boolean> {
  if (!canShareFiles() || !navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: file.name });
    return true;
  } catch {
    return false;
  }
}

/** Saves a file through a download link (the address may be an object URL). */
export function download(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The part of a path after the last slash or backslash. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

