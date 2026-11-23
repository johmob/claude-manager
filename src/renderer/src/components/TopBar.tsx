import type { AppSettings, DockEdge, UpdateStatus } from '../../../shared/contracts';
import { send } from '../lib/api';
import { ChatIcon, ExistingProjectIcon, NewProjectIcon, RulesIcon } from './Icons';
import type { DialogKind } from './StartDialogs';

export type ViewMode = 'overview' | 'focus';

interface TopBarProps {
  update: UpdateStatus;
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

/** "Auto-uppdatera" (on/off), and the new version with "Installera nu" once there is one. */
function UpdateControl({ update }: { update: UpdateStatus }) {
  const state =
    update.state === 'off'
      ? update.message
      : update.state === 'error'
        ? `Kunde inte söka efter uppdateringar: ${update.message}`
        : update.available
          ? `Version ${update.available} finns`
          : 'Senaste versionen';
  const title = `Version ${update.version}. ${state}. På: nya versioner installeras av sig själva när ingen session arbetar eller väntar på dig.`;
  const newer = update.available && (update.state === 'available' || update.state === 'downloading' || update.state === 'ready');
  return (
    <>
      {newer && (
        <button
          type="button"
          className="update-pill"
          disabled={update.state === 'downloading'}
          title={update.auto ? 'Installeras av sig själv när inget arbetar. Klicka för att installera nu (appen startar om).' : 'Klicka för att installera (appen startar om).'}
          onClick={() => send('update:install', undefined)}
        >
          {update.state === 'downloading' ? `Hämtar ${update.available} · ${update.progress} %` : `Version ${update.available} · Installera nu`}
        </button>
      )}
      <Toggle label="Auto-uppdatera" title={title} on={update.auto} onChange={(autoUpdate) => send('settings:update', { autoUpdate })} />
    </>
  );
}

function Toggle(props: { label: string; on: boolean; onChange: (on: boolean) => void; title?: string }) {
  return (
    <button type="button" title={props.title} className={props.on ? 'toggle on' : 'toggle'} aria-pressed={props.on} onClick={() => props.onChange(!props.on)}>
      <span className="toggle-dot" />
      {props.label}
    </button>
  );
}

export function TopBar({ settings, update, view, onView, onDialog }: TopBarProps) {
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
        <UpdateControl update={update} />
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
