import { useEffect, useState } from 'react';

export type FileAction = 'save-as' | 'copy' | 'mail' | 'show';

/** Runs a file action on the computer. */
export function fileAct(path: string, action: FileAction): Promise<void> {
  // main reads the target like a link target: percent-encoded.
  return window.cm.invoke('file:act', { target: encodeURIComponent(path), action });
}

/** Opens the file with its Windows program. */
export function openFile(path: string): void {
  window.cm.invoke('shell:open', { target: encodeURIComponent(path) }).catch((e: unknown) => console.error('shell:open', e));
}

let outlookKnown: Promise<boolean> | null = null;

/** True when classic Outlook exists on the computer (asked once). */
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

/** The part of a path after the last slash or backslash. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

