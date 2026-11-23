import type { AppSettings, DockEdge } from '../../../shared/contracts';
import { send } from '../lib/api';
import { ChatIcon, ExistingProjectIcon, NewProjectIcon, RulesIcon } from './Icons';
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
      <nav className="start-menu" aria-label="Starta">
        <button type="button" onClick={() => onDialog('chat')}><ChatIcon />Ny chatt</button>
        <button type="button" onClick={() => onDialog('project')}><NewProjectIcon />Nytt projekt</button>
        <button type="button" onClick={() => onDialog('existing')}><ExistingProjectIcon />Befintligt projekt</button>
        <span className="start-menu-sep" />
        <button type="button" onClick={() => onDialog('rules')}><RulesIcon />Grundregler</button>
      </nav>
      <div className="view-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'overview'} onClick={() => onView('overview')}>Översikt</button>
        <button type="button" role="tab" aria-selected={view === 'focus'} onClick={() => onView('focus')}>Fokus</button>
      </div>
      <div className="topbar-group topbar-settings">
        <Toggle label="Stör ej" on={settings.doNotDisturb} onChange={(doNotDisturb) => send('settings:update', { doNotDisturb })} />
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
