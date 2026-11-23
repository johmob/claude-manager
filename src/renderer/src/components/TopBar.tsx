import type { AppSettings, DockEdge } from '../../../shared/contracts';
import { send } from '../lib/api';
import type { DialogKind } from './StartDialogs';

export type ViewMode = 'overview' | 'focus';

interface TopBarProps {
  settings: AppSettings;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  onDialog: (k: DialogKind) => void;
}

const EDGES: { value: DockEdge; label: string }[] = [
  { value: 'right', label: 'Höger' },
  { value: 'bottom', label: 'Botten' },
  { value: 'center', label: 'Mitten' },
];

function Toggle(props: { label: string; on: boolean; onChange: (on: boolean) => void; title?: string }) {
  return (
    <button type="button" title={props.title} className={props.on ? 'toggle on' : 'toggle'} aria-pressed={props.on} onClick={() => props.onChange(!props.on)}>
      <span className="toggle-dot" />
      {props.label}
    </button>
  );
}

export function TopBar({ settings, view, onView, onDialog }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="app-name">Claude Code Manager</div>
      <div className="topbar-group">
        <button type="button" className="btn primary" onClick={() => onDialog('chat')}>Ny chatt</button>
        <button type="button" className="btn" onClick={() => onDialog('project')}>Nytt projekt</button>
        <button type="button" className="btn" onClick={() => onDialog('existing')}>Befintligt projekt</button>
        <button type="button" className="btn" onClick={() => onDialog('rules')}>Grundregler</button>
      </div>
      <div className="segmented">
        <button type="button" className={view === 'overview' ? 'active' : ''} onClick={() => onView('overview')}>Översikt</button>
        <button type="button" className={view === 'focus' ? 'active' : ''} onClick={() => onView('focus')}>Fokus</button>
      </div>
      <span className="spacer" />
      <div className="topbar-group">
        <Toggle label="Stör ej" on={settings.doNotDisturb} onChange={(doNotDisturb) => send('settings:update', { doNotDisturb })} />
        <Toggle
          label="Granskning"
          title="Extra, oberoende granskning av varje avslutad tur med Haiku (kostar lite kvot). Agenterna taggar viktiga saker själva ändå."
          on={settings.reviewEnabled}
          onChange={(reviewEnabled) => send('settings:update', { reviewEnabled })}
        />
        <Toggle label="Docka" on={settings.dockVisible} onChange={(dockVisible) => send('settings:update', { dockVisible })} />
        <select
          className="input compact"
          title="Dockans placering"
          value={settings.dockEdge}
          onChange={(e) => send('settings:update', { dockEdge: e.target.value as DockEdge })}
        >
          {EDGES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
        <Toggle label="Overlay" on={settings.overlayVisible} onChange={(overlayVisible) => send('settings:update', { overlayVisible })} />
      </div>
    </header>
  );
}
