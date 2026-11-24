import type { SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';

/** "12 commits, 3 ändrade filer, 2 ej committade" */
function summary(drift: NonNullable<SessionSummary['drift']>): string {
  return [
    drift.commits > 0 ? `${drift.commits} ${drift.commits === 1 ? 'commit' : 'commits'}` : drift.commits < 0 ? 'omskriven historik' : '',
    drift.fileCount ? `${drift.fileCount} ${drift.fileCount === 1 ? 'ändrad fil' : 'ändrade filer'}` : '',
    drift.uncommitted ? `${drift.uncommitted} ej committade` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Work done on the project outside the app since the agent last worked here, with what to do about it:
 * update the work schema from the change list (the default), map the project anew, or let it be. Writing
 * to the agent also hands it the change list.
 */
export function DriftBar({ session }: { session: SessionSummary }) {
  const { drift } = session;
  if (!drift) return null;
  const act = (action: 'update' | 'remap' | 'ignore'): void => send('session:drift', { id: session.id, action });
  return (
    <div className="drift-bar" onClick={(e) => e.stopPropagation()}>
      <div className="drift-text" title={drift.log.slice(0, 10).join('\n')}>
        <strong>Ändrat utanför appen</strong> · {summary(drift)}
      </div>
      <div className="drift-actions">
        <button type="button" className="btn small primary" title="Agenten läser ändringarna och uppdaterar arbetsschemat" onClick={() => act('update')}>Uppdatera schemat</button>
        <button type="button" className="btn small" title="Rita om hela arbetsschemat" onClick={() => act('remap')}>Kartlägg om</button>
        <button type="button" className="btn small" title="Gör inget nu" onClick={() => act('ignore')}>Ignorera</button>
      </div>
    </div>
  );
}
