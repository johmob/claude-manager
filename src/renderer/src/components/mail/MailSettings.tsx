import { useState } from 'react';
import type { AppSettings, MailSourceState } from '../../../../shared/contracts';
import { send } from '../../lib/api';
import { modelOptions, useAccount } from '../../state/account';
import { useMail } from '../../state/useMail';
import '../../styles/mail-list.css';

const SOURCE_TEXT: Record<MailSourceState, string> = {
  off: 'Av',
  starting: 'Ansluter till Outlook…',
  connected: 'Ansluten till Outlook',
  'outlook-not-running': 'Outlook är inte igång',
  error: 'Kunde inte läsa från Outlook',
};

/** The mail switch of the settings menu: off by default, with a consent text before it is turned on. */
export function MailSettings({ settings }: { settings: AppSettings }) {
  const account = useAccount();
  const overview = useMail();
  const [asking, setAsking] = useState(false);
  const source = overview?.source;
  const retry = source && (source.state === 'outlook-not-running' || source.state === 'error');

  return (
    <div className="mail-settings">
      <button
        type="button"
        className={settings.mailEnabled ? 'toggle on' : 'toggle'}
        aria-pressed={settings.mailEnabled}
        title="Läser och sorterar mejl i det Outlook som är igång"
        onClick={() => {
          if (settings.mailEnabled) send('settings:update', { mailEnabled: false });
          else setAsking(!asking);
        }}
      >
        <span className="toggle-dot" />
        Mejl (Outlook)
      </button>
      {!settings.mailEnabled && !asking && <p className="mail-settings-note">Av. När det är på skickas mejlens innehåll till Claude för sortering.</p>}
      {asking && !settings.mailEnabled && (
        <div className="mail-consent" role="group" aria-label="Slå på mejl">
          <p>
            Nya mejls text skickas till Claude för sortering, utom avsändare och ämnen du undantagit. Inget skickas från Outlook utan att du godkänner det,
            och allt sparas bara på den här datorn. Kontrollera att din arbetsplats tillåter det.
          </p>
          <div className="mail-consent-buttons">
            <button type="button" className="btn" onClick={() => { setAsking(false); send('settings:update', { mailEnabled: true }); }}>Slå på</button>
            <button type="button" className="btn" onClick={() => setAsking(false)}>Avbryt</button>
          </div>
        </div>
      )}
      {settings.mailEnabled && (
        <>
          <p className="mail-settings-note">Mejlens innehåll skickas till Claude för sortering.</p>
          <div className="settings-row">
            <span>{source ? SOURCE_TEXT[source.state] : 'Ansluter…'}</span>
            {retry && <button type="button" className="link-btn" onClick={() => send('mail:reconnect', undefined)}>Försök igen</button>}
          </div>
          <label className="settings-row">
            <span>Mejlagentens modell</span>
            <select className="input compact" value={settings.mailModel} onChange={(e) => send('settings:update', { mailModel: e.target.value as AppSettings['mailModel'] })}>
              {modelOptions(account, settings.mailModel).map((m) => <option key={m.choice} value={m.choice}>{m.label}</option>)}
            </select>
          </label>
        </>
      )}
    </div>
  );
}
