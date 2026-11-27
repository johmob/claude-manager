import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { VOICE_SILENCE_DEFAULT, type VoiceStatus } from '../../../shared/voice';
import type { VoiceApi } from '../components/MicButton';

/** What voice input needs from the settings. */
interface VoiceSettingsState {
  silenceSeconds: number;
  autoSend: boolean;
  cleanup: boolean;
}

interface Store {
  status: VoiceStatus;
  settings: VoiceSettingsState;
}

const UNKNOWN: VoiceStatus = { state: 'missing', progress: 0, totalBytes: 0, message: '' };

// One store per window, shared by every mic button in it: the subscriptions are made once, on first use.
let store: Store = { status: UNKNOWN, settings: { silenceSeconds: VOICE_SILENCE_DEFAULT, autoSend: true, cleanup: false } };
const listeners = new Set<() => void>();
let started = false;

function set(patch: Partial<Store>): void {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
}

function settingsOf(s: { voiceSilenceSeconds: number; voiceAutoSend: boolean; voiceCleanup: boolean }): VoiceSettingsState {
  const prev = store.settings;
  if (prev.silenceSeconds === s.voiceSilenceSeconds && prev.autoSend === s.voiceAutoSend && prev.cleanup === s.voiceCleanup) return prev;
  return { silenceSeconds: s.voiceSilenceSeconds, autoSend: s.voiceAutoSend, cleanup: s.voiceCleanup };
}

function start(): void {
  if (started) return;
  started = true;
  window.cm.on('state:voice', (status) => set({ status }));
  window.cm.on('state:settings', (s) => set({ settings: settingsOf(s) }));
  window.cm.invoke('voice:status', undefined).then((status) => set({ status }), (e: unknown) => console.error('voice:status', e));
  window.cm.invoke('app:get-state', undefined).then((s) => set({ settings: settingsOf(s.settings) }), (e: unknown) => console.error('app:get-state', e));
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export interface VoiceText {
  /** What is shown: cleaned when clean-up is on and asked for, otherwise the same as `raw`. */
  text: string;
  /** What whisper heard. */
  raw: string;
}

export interface UseVoice extends VoiceSettingsState {
  status: VoiceStatus;
  prepare(): void;
  /** Transcribes a recording; `clean: false` skips the Haiku clean-up even when it is switched on. */
  transcribe(wav: Uint8Array, opts?: { clean?: boolean }): Promise<VoiceText>;
  /** The plain form MicButton takes: cleaned text when clean-up is on. */
  api: VoiceApi;
  /** Like `api` but never cleaned up (answers in the question box). */
  rawApi: VoiceApi;
}

/** Voice input state and actions: availability and download progress, the voice settings, and transcription. */
export function useVoice(): UseVoice {
  const snapshot = useSyncExternalStore(subscribe, () => store);
  const prepare = useCallback((): void => {
    window.cm.invoke('voice:prepare', undefined).catch((e: unknown) => console.error('voice:prepare', e));
  }, []);
  const { cleanup } = snapshot.settings;
  const transcribe = useCallback(
    async (wav: Uint8Array, opts?: { clean?: boolean }): Promise<VoiceText> => {
      const { text: raw } = await window.cm.invoke('voice:transcribe', { wav });
      if (!cleanup || opts?.clean === false || !raw.trim()) return { text: raw, raw };
      const cleaned = await window.cm.invoke('voice:clean', { text: raw }).catch(() => ({ text: raw }));
      return { text: cleaned.text || raw, raw };
    },
    [cleanup],
  );
  const status = snapshot.status;
  const api = useMemo<VoiceApi>(
    () => ({ status, prepare, transcribe: async (wav) => (await transcribe(wav)).text }),
    [status, prepare, transcribe],
  );
  const rawApi = useMemo<VoiceApi>(
    () => ({ status, prepare, transcribe: async (wav) => (await transcribe(wav, { clean: false })).text }),
    [status, prepare, transcribe],
  );
  return { ...snapshot.settings, status, prepare, transcribe, api, rawApi };
}
