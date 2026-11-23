import { useState, type CSSProperties } from 'react';

const MAX_FILLING = 6;

/** Columns for a few cards sharing the window: 1, 2, 3, 2 (2x2), 3, 3. */
function columns(count: number): number {
  return count === 4 ? 2 : Math.min(count, 3);
}
import type { SessionSummary, UsageSnapshot } from '../../../shared/contracts';
import { send } from '../lib/api';
import { SessionCard } from '../components/SessionCard';
import { WorkSchema } from '../components/WorkSchema';
import { UsagePanel } from '../components/UsagePanel';
import type { DialogKind } from '../components/StartDialogs';

interface OverviewViewProps {
  sessions: SessionSummary[];
  usage: UsageSnapshot;
  onDialog: (k: DialogKind) => void;
}

function EmptyState({ onDialog }: { onDialog: (k: DialogKind) => void }) {
  return (
    <div className="empty-state">
      <h2>Inga sessioner ännu</h2>
      <p>Starta en chatt eller ett projekt så dyker det upp här som ett kort.</p>
      <div className="topbar-group">
        <button type="button" className="btn primary" onClick={() => onDialog('chat')}>Ny chatt</button>
        <button type="button" className="btn" onClick={() => onDialog('project')}>Nytt projekt</button>
        <button type="button" className="btn" onClick={() => onDialog('existing')}>Befintligt projekt</button>
      </div>
    </div>
  );
}

export function OverviewView({ sessions, usage, onDialog }: OverviewViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openSession = sessions.find((s) => s.id === openId) ?? null;
  // Up to six cards share the window (larger cards with the latest answer); more scroll as a grid.
  const fills = sessions.length > 0 && sessions.length <= MAX_FILLING;

  const open = (s: SessionSummary): void => {
    setOpenId(s.id);
    if (s.status === 'done') send('session:mark-seen', { id: s.id });
  };

  return (
    <div className="overview">
      <div className="overview-main">
        {sessions.length === 0 ? (
          <EmptyState onDialog={onDialog} />
        ) : (
          <div className="card-grid" data-fill={fills ? 'true' : undefined} style={fills ? ({ '--cols': columns(sessions.length) } as CSSProperties) : undefined}>
            {sessions.map((s) => (
              <SessionCard key={s.id} session={s} onOpen={() => open(s)} roomy={fills} />
            ))}
          </div>
        )}
      </div>
      <UsagePanel usage={usage} />
      {openSession && <WorkSchema session={openSession} onClose={() => setOpenId(null)} />}
    </div>
  );
}
