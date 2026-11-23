import { useEffect, useSyncExternalStore } from 'react';
import type { TranscriptEntry } from '../../../shared/contracts';

// Module-level store: transcripts are shared by every tile and survive tile remounts.
const EMPTY: TranscriptEntry[] = [];
const transcripts = new Map<string, TranscriptEntry[]>();
const requested = new Set<string>();
const listeners = new Set<() => void>();
let subscribed = false;

function emit(): void {
  listeners.forEach((l) => l());
}

function upsert(list: TranscriptEntry[], entry: TranscriptEntry): TranscriptEntry[] {
  const i = list.findIndex((e) => e.id === entry.id);
  if (i === -1) return [...list, entry];
  const next = list.slice();
  next[i] = entry;
  return next;
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  window.cm.on('session:transcript-upsert', ({ id, entry }) => {
    transcripts.set(id, upsert(transcripts.get(id) ?? EMPTY, entry));
    emit();
  });
}

function load(id: string): void {
  if (requested.has(id)) return;
  requested.add(id);
  window.cm
    .invoke('session:transcript', { id })
    .then((fetched) => {
      // Merge: entries pushed while the fetch was in flight win over the snapshot.
      const pushed = transcripts.get(id) ?? EMPTY;
      const merged = pushed.reduce(upsert, fetched);
      transcripts.set(id, merged);
      emit();
    })
    .catch((e: unknown) => {
      requested.delete(id);
      console.error('session:transcript', e);
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Live transcript of one session; fetched on first use. */
export function useTranscript(id: string): TranscriptEntry[] {
  ensureSubscribed();
  useEffect(() => load(id), [id]);
  return useSyncExternalStore(subscribe, () => transcripts.get(id) ?? EMPTY);
}
