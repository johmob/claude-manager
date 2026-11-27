import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff } from 'lucide-react';
import type { VoiceStatus } from '../../../shared/voice';
import { startRecording, type Recording } from '../lib/recorder';
import '../styles/voice.css';

export interface VoiceApi {
  status: VoiceStatus;
  prepare(): void;
  /** Already cleaned when clean-up is on. */
  transcribe(wav: Uint8Array): Promise<string>;
}

type Phase = 'idle' | 'listening' | 'transcribing';

const NEED_DOWNLOAD = 'Röstinmatning behöver hämtas en gång (≈ 185 MB). Klicka för att hämta.';

export function MicButton(props: {
  voice: VoiceApi;
  silenceSeconds: number;
  onText(text: string): void;
  compact?: boolean;
  title?: string;
}) {
  const { voice, silenceSeconds, onText, compact, title } = props;
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState('');
  const rec = useRef<Recording | null>(null);
  /** Bumped on every start and cancel; a result from an older run is dropped. */
  const run = useRef(0);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const showHint = useCallback((msg: string) => {
    setHint(msg);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(''), 5000);
  }, []);

  const cancel = useCallback(() => {
    run.current++;
    rec.current?.cancel();
    rec.current = null;
    setLevel(0);
    setPhase('idle');
  }, []);

  useEffect(() => () => {
    run.current++;
    rec.current?.cancel();
    clearTimeout(hintTimer.current);
  }, []);

  useEffect(() => {
    if (phase !== 'listening') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase, cancel]);

  const start = () => {
    const my = ++run.current;
    setHint('');
    setPhase('listening');
    const r = startRecording({ silenceMs: silenceSeconds * 1000, onLevel: (l) => { if (run.current === my) setLevel(l); } });
    rec.current = r;
    r.done.then(async (res) => {
      if (run.current !== my) return;
      rec.current = null;
      setLevel(0);
      if (!res) { setPhase('idle'); showHint('Hörde inget'); return; }
      setPhase('transcribing');
      try {
        const text = (await voiceRef.current.transcribe(res.wav)).trim();
        if (run.current !== my) return;
        setPhase('idle');
        if (!text) showHint('Hörde inget');
        else onTextRef.current(text);
      } catch (e) {
        if (run.current !== my) return;
        setPhase('idle');
        showHint(e instanceof Error ? e.message : String(e));
      }
    }, (e) => {
      if (run.current !== my) return;
      rec.current = null;
      setLevel(0);
      setPhase('idle');
      showHint(e instanceof Error ? e.message : String(e));
    });
  };

  const st = voice.status.state;
  const downloading = st === 'downloading';
  const needDownload = st === 'missing' || st === 'error';

  const onClick = () => {
    if (phase === 'listening' || phase === 'transcribing') return cancel();
    if (downloading) return;
    if (needDownload) { voice.prepare(); return; }
    start();
  };

  let mode: string = phase;
  if (phase === 'idle') mode = downloading ? 'downloading' : needDownload ? 'need-download' : 'idle';
  const pct = Math.max(0, Math.min(100, Math.round(voice.status.progress)));
  const tip = title
    ?? (phase === 'listening' ? 'Lyssnar… klicka för att avbryta'
      : phase === 'transcribing' ? 'Skriver ut…'
      : downloading ? `Hämtar röstinmatning… ${pct} %`
      : needDownload ? (st === 'error' && voice.status.message ? `${voice.status.message} Klicka för att försöka igen.` : NEED_DOWNLOAD)
      : 'Prata (slutar själv när du tystnar)');
  const shownTip = title && phase === 'idle' && !downloading && needDownload ? NEED_DOWNLOAD : tip;

  return (
    <span className={`mic-wrap${compact ? ' compact' : ''}`}>
      <button
        type="button"
        className={`mic-btn ${mode}${compact ? ' compact' : ''}`}
        title={shownTip}
        aria-label={shownTip}
        aria-pressed={phase === 'listening'}
        onClick={onClick}
        style={phase === 'listening' ? ({ '--mic-level': Math.min(1, level * 4).toFixed(2) } as React.CSSProperties) : undefined}
      >
        {phase === 'listening' && <span className="mic-ring" />}
        {downloading && <span className="mic-progress" style={{ background: `conic-gradient(var(--accent-ui) ${pct * 3.6}deg, transparent 0)` }} />}
        {phase === 'transcribing' ? <Loader2 size={compact ? 14 : 16} className="mic-spin" />
          : st === 'error' && phase === 'idle' ? <MicOff size={compact ? 14 : 16} />
          : downloading ? <span className="mic-pct">{pct}</span>
          : <Mic size={compact ? 14 : 16} />}
      </button>
      {hint && <span className="mic-hint" role="status">{hint}</span>}
    </span>
  );
}
