import { useState } from 'react';
import type { SessionSummary, UsageSnapshot } from '../../../shared/contracts';
import { send } from '../lib/api';
import { MAX_FOCUS, type Selection } from '../state/useSelection';
import { SessionCard } from '../components/SessionCard';
import { WorkSchema } from '../components/WorkSchema';
import { UsagePanel } from '../components/UsagePanel';
import type { DialogKind } from '../components/StartDialogs';

interface OverviewViewProps {
  sessions: SessionSummary[];
  usage: UsageSnapshot;
  selection: Selection;
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

export function OverviewView({ sessions, usage, selection, onDialog }: OverviewViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openSession = sessions.find((s) => s.id === openId) ?? null;
  const selectedCount = sessions.filter((s) => selection.selected.includes(s.id)).length;

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
          <div className="card-grid">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                selected={selection.selected.includes(s.id)}
                selectDisabled={selectedCount >= MAX_FOCUS}
                onToggleSelect={() => selection.toggle(s.id)}
                onOpen={() => open(s)}
              />
            ))}
          </div>
        )}
      </div>
      <UsagePanel usage={usage} />
      {openSession && <WorkSchema session={openSession} onClose={() => setOpenId(null)} />}
    </div>
  );
}
