import { useEffect, useRef, useState } from 'react';
import type { AppSettings, DockEdge, UpdateStatus } from '../../../shared/contracts';
import { send } from '../lib/api';
import { ChatIcon, ExistingProjectIcon, NewProjectIcon, NoSleepIcon, RulesIcon } from './Icons';
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

/** The newer version with "Installera nu", shown in the bar only while there is one. */
function UpdatePill({ update }: { update: UpdateStatus }) {
  const newer = update.available && (update.state === 'available' || update.state === 'downloading' || update.state === 'ready');
  if (!newer) return null;
  return (
    <button
      type="button"
      className="update-pill"
      disabled={update.state === 'downloading'}
      title={update.auto ? 'Installeras av sig själv när inget arbetar. Klicka för att installera nu (appen startar om).' : 'Klicka för att installera (appen startar om).'}
      onClick={() => send('update:install', undefined)}
    >
      {update.state === 'downloading' ? `Hämtar ${update.available} · ${update.progress} %` : `Version ${update.available} · Installera nu`}
    </button>
  );
}

/** What the update check found, in words, for the settings menu. */
function updateText(update: UpdateStatus): string {
  if (update.state === 'off') return update.message;
  if (update.state === 'error') return `Kunde inte söka efter uppdateringar: ${update.message}`;
  return update.available ? `Version ${update.available} finns` : 'Senaste versionen';
}

function Toggle(props: { label: string; on: boolean; onChange: (on: boolean) => void; title?: string }) {
  return (
    <button type="button" title={props.title} className={props.on ? 'toggle on' : 'toggle'} aria-pressed={props.on} onClick={() => props.onChange(!props.on)}>
      <span className="toggle-dot" />
      {props.label}
    </button>
  );
}

/** Settings changed now and then: look, updates and where the dock sits. Closes on a click outside. */
function SettingsMenu({ settings, update }: { settings: AppSettings; update: UpdateStatus }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="settings-menu" ref={ref}>
      <button type="button" className={open ? 'toggle on settings-btn' : 'toggle settings-btn'} title="Inställningar" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⚙
      </button>
      {open && (
        <div className="settings-pop">
          <Toggle
            label="Nattläge"
            title="Djupare svart, högre kontrast och glöd"
            on={settings.theme === 'night'}
            onChange={(on) => send('settings:update', { theme: on ? 'night' : 'standard' })}
          />
          <Toggle
            label="Auto-uppdatera"
            title="Nya versioner installeras av sig själva när ingen session arbetar eller väntar på dig."
            on={update.auto}
            onChange={(autoUpdate) => send('settings:update', { autoUpdate })}
          />
          <Toggle
            label="Fortsätt efter gränsen"
            title="Sessioner som stoppats av användningsgränsen fortsätter av sig själva när den har återställts."
            on={settings.autoResume}
            onChange={(autoResume) => send('settings:update', { autoResume })}
          />
          <label className="settings-row">
            <span>Dockan</span>
            <select className="input compact" value={settings.dockEdge} onChange={(e) => send('settings:update', { dockEdge: e.target.value as DockEdge })}>
              {EDGES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </label>
          <div className="settings-version">
            Version {update.version} · {update.state === 'checking' ? 'Söker…' : updateText(update)}
            {update.state !== 'off' && (
              <button type="button" className="link-btn" disabled={update.state === 'checking' || update.state === 'downloading'} onClick={() => send('update:check', undefined)}>
                Sök efter uppdatering nu
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TopBar({ settings, update, view, onView, onDialog }: TopBarProps) {
  return (
    <header className="topbar">
      <nav className="start-menu" aria-label="Starta">
        <button type="button" title="Ny chatt" onClick={() => onDialog('chat')}><ChatIcon /><span className="start-label">Ny chatt</span></button>
        <button type="button" title="Nytt projekt" onClick={() => onDialog('project')}><NewProjectIcon /><span className="start-label">Nytt projekt</span></button>
        <button type="button" title="Befintligt projekt" onClick={() => onDialog('existing')}><ExistingProjectIcon /><span className="start-label">Befintligt projekt</span></button>
        <span className="start-menu-sep" />
        <button type="button" title="Grundregler" onClick={() => onDialog('rules')}><RulesIcon /><span className="start-label">Grundregler</span></button>
      </nav>
      <div className="view-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'overview'} onClick={() => onView('overview')}>Översikt</button>
        <button type="button" role="tab" aria-selected={view === 'focus'} onClick={() => onView('focus')}>Fokus</button>
      </div>
      <div className="topbar-group topbar-settings">
        <UpdatePill update={update} />
        <button
          type="button"
          className={settings.keepAwake ? 'toggle on icon-toggle' : 'toggle icon-toggle'}
          aria-pressed={settings.keepAwake}
          title={settings.keepAwake ? 'Håller datorn vaken och olåst (ingen vila, ingen skärmsläckning, ingen utloggning vid inaktivitet). Klicka för att stänga av.' : 'Håll datorn vaken och olåst, så att agenterna kan arbeta i natt'}
          onClick={() => send('settings:update', { keepAwake: !settings.keepAwake })}
        >
          <NoSleepIcon />
        </button>
        <Toggle label="Stör ej" on={settings.doNotDisturb} onChange={(doNotDisturb) => send('settings:update', { doNotDisturb })} />
        <Toggle label="Docka" on={settings.dockVisible} onChange={(dockVisible) => send('settings:update', { dockVisible })} />
        <Toggle label="Overlay" on={settings.overlayVisible} onChange={(overlayVisible) => send('settings:update', { overlayVisible })} />
        <SettingsMenu settings={settings} update={update} />
      </div>
    </header>
  );
}
