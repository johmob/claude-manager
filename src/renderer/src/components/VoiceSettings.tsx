import { VOICE_SILENCE_MAX, VOICE_SILENCE_MIN, type VoiceStatus } from '../../../shared/voice';
import '../styles/voice.css';

export interface VoiceSettingsPatch {
  voiceSilenceSeconds?: number;
  voiceAutoSend?: boolean;
  voiceCleanup?: boolean;
}

function Switch(props: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      className={props.on ? 'toggle on' : 'toggle'}
      aria-pressed={props.on}
      onClick={() => props.onChange(!props.on)}
    >
      <span className="toggle-dot" />
      {props.label}
    </button>
  );
}

export function VoiceSettings(props: {
  silenceSeconds: number;
  autoSend: boolean;
  cleanup: boolean;
  status: VoiceStatus;
  onChange(patch: VoiceSettingsPatch): void;
  onPrepare(): void;
}) {
  const { silenceSeconds, autoSend, cleanup, status, onChange, onPrepare } = props;
  const mb = Math.round(status.totalBytes / 1_000_000) || 185;
  return (
    <div className="voice-settings">
      <label className="settings-row">
        <span>Tystnad innan stopp</span>
        <span className="voice-slider">
          <input
            type="range"
            min={VOICE_SILENCE_MIN}
            max={VOICE_SILENCE_MAX}
            step={0.5}
            value={silenceSeconds}
            onChange={(e) => onChange({ voiceSilenceSeconds: Number(e.target.value) })}
          />
          <span className="voice-value">{silenceSeconds} s</span>
        </span>
      </label>
      <div className="settings-row">
        <Switch
          label="Skicka direkt"
          on={autoSend && !cleanup}
          disabled={cleanup}
          onChange={(voiceAutoSend) => onChange({ voiceAutoSend })}
        />
        {cleanup && <span className="voice-note">Av när talspråket städas</span>}
      </div>
      <div className="settings-row">
        <Switch
          label="Städa talspråket (Haiku)"
          on={cleanup}
          onChange={(voiceCleanup) => onChange({ voiceCleanup })}
          title="Haiku skriver om det du sa till en tydlig instruktion. Texten läggs i rutan så att du ser den innan den skickas."
        />
      </div>
      <div className="settings-row voice-status">
        {status.state === 'ready' && <span>Installerad: KB-whisper small, körs lokalt</span>}
        {status.state === 'downloading' && (
          <span className="voice-download">
            <span>Hämtar… {Math.round(status.progress)} %</span>
            <span className="voice-bar"><span style={{ width: `${Math.max(0, Math.min(100, status.progress))}%` }} /></span>
          </span>
        )}
        {(status.state === 'missing' || status.state === 'error') && (
          <>
            <span className={status.state === 'error' ? 'voice-error' : undefined}>
              {status.state === 'error' && status.message ? status.message : 'Röstinmatning är inte installerad'}
            </span>
            <button type="button" className="input compact" onClick={onPrepare}>
              {status.state === 'error' ? 'Försök igen' : `Hämta (≈ ${mb} MB)`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
