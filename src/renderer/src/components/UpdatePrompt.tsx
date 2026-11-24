import type { SessionSummary, UpdateStatus } from '../../../shared/contracts';
import { send } from '../lib/api';

/**
 * A new version is downloaded: install now (the app restarts) or at the next restart. Shown until the user
 * chooses; without an answer it installs at the next restart. Warns when installing now would cut off work.
 */
export function UpdatePrompt({ update, sessions }: { update: UpdateStatus; sessions: SessionSummary[] }) {
  if (update.state !== 'ready' || update.deferred || !update.available) return null;
  const busy = sessions.filter((s) => s.status === 'working' || s.activeAgents > 0).length;
  return (
    <div className="update-prompt" role="dialog" aria-label="Ny version">
      <div className="update-prompt-text">
        <strong>Version {update.available} är klar att installera</strong>
        <span className="muted">
          {busy ? `${busy} ${busy === 1 ? 'session arbetar och avbryts' : 'sessioner arbetar och avbryts'} om du uppdaterar nu.` : 'Appen startar om, det tar några sekunder.'}
        </span>
      </div>
      <div className="update-prompt-actions">
        <button type="button" className="btn small" onClick={() => send('update:defer', undefined)}>Vid nästa omstart</button>
        <button type="button" className="btn small primary" onClick={() => send('update:install', undefined)}>Uppdatera nu</button>
      </div>
    </div>
  );
}
