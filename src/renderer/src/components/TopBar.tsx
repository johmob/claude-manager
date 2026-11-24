import { useEffect, useRef, useState } from 'react';
import type { AppSettings, DockEdge, RemoteStatus, UpdateStatus } from '../../../shared/contracts';
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
      title={update.state === 'ready' && update.auto ? 'Installeras vid nästa omstart. Klicka för att installera nu (appen startar om).' : 'Klicka för att installera nu (appen startar om).'}
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

/** Phone access: off by default; the URLs, the pairing QR code and the firewall rule to add. Not shown in a browser on the phone itself. */
function RemoteAccess({ settings }: { settings: AppSettings }) {
  const { enabled, port } = settings.remoteAccess;
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [portText, setPortText] = useState(String(port));
  const [copied, setCopied] = useState(false);
  useEffect(() => setPortText(String(port)), [port]);
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      window.cm.invoke('remote:status', undefined).then((s) => alive && setStatus(s), () => undefined);
    };
    load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled, port]);
  if (!status) return null;
  const update = (changes: Partial<AppSettings['remoteAccess']>): void => send('settings:update', { remoteAccess: { enabled, port, ...changes } });
  const commitPort = (): void => {
    const n = Number(portText);
    if (Number.isInteger(n) && n >= 1024 && n <= 65535) {
      if (n !== port) update({ port: n });
    } else setPortText(String(port));
  };
  return (
    <div className="remote-box">
      <Toggle
        label="Fjärråtkomst (mobil)"
        title="Datorn serverar appen över HTTPS till telefonen på hemnätet (eller via VPN). Bara privata adresser släpps in och telefonen måste paras med en nyckel."
        on={enabled}
        onChange={(on) => update({ enabled: on })}
      />
      <label className="settings-row">
        <span>Port</span>
        <input className="input compact remote-port" inputMode="numeric" value={portText} onChange={(e) => setPortText(e.target.value)} onBlur={commitPort} onKeyDown={(e) => e.key === 'Enter' && commitPort()} />
      </label>
      {enabled && status.error && <div className="remote-error">{status.error}</div>}
      {enabled && status.running && (
        <>
          <div className="remote-urls">{status.urls.length ? status.urls.map((u) => <div key={u}>{u}</div>) : 'Ingen privat nätverksadress hittades.'}</div>
          {status.qr && <img className="remote-qr" src={status.qr} alt="QR-kod för parning" title={status.pairingUrl ?? ''} />}
          <div className="remote-note">Skanna QR-koden med telefonen. Första gången: öppna adressen /ca.crt och installera certifikatet som CA-certifikat. {status.clients ? `${status.clients} ansluten.` : ''}</div>
          <button type="button" className="link-btn settings-link" onClick={() => void window.cm.invoke('remote:new-key', undefined).then(setStatus)}>Ny nyckel (kopplar bort parade telefoner)</button>
        </>
      )}
      <div className="remote-note">
        Windows-brandväggen måste släppa in porten (kör som administratör):
        <code
          className="remote-cmd"
          title="Klicka för att kopiera"
          onClick={() => void navigator.clipboard.writeText(status.firewallCommand).then(() => setCopied(true))}
        >
          {status.firewallCommand}
        </code>
        {copied && <span> Kopierat.</span>}
      </div>
    </div>
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
            title="Nya versioner hämtas i bakgrunden och installeras vid nästa omstart. Appen startar aldrig om av sig själv; Installera nu i toppraden installerar direkt."
            on={update.auto}
            onChange={(autoUpdate) => send('settings:update', { autoUpdate })}
          />
          <Toggle
            label="Loggning"
            title="Appen sparar en logg över vad agenterna skickar och hur det visas, så att fel går att följa upp. Den stannar på datorn."
            on={settings.logging}
            onChange={(logging) => send('settings:update', { logging })}
          />
          <button type="button" className="link-btn settings-link" onClick={() => send('log:open-folder', undefined)}>Öppna loggmappen</button>
          <Toggle
            label="Fortsätt efter gränsen"
            title="Sessioner som stoppats av användningsgränsen fortsätter av sig själva när den har återställts."
            on={settings.autoResume}
            onChange={(autoResume) => send('settings:update', { autoResume })}
          />
          <RemoteAccess settings={settings} />
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
      <span className="topbar-sep" />
      {/* Left, next to the start menu: the overlay sits in the middle of the screen and would cover them there. */}
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
