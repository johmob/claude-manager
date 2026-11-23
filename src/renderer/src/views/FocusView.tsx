import type { CSSProperties } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';
import { SessionTile } from '../components/SessionTile';

/** Columns for 1..6 tiles: 1x1, 2x1, 3x1, 2x2, 3x2, 3x2. */
function columnsFor(n: number): number {
  if (n <= 3) return Math.max(1, n);
  return n === 4 ? 2 : 3;
}

export function FocusView({ sessions }: { sessions: SessionSummary[] }) {
  const cols = columnsFor(sessions.length);
  const rows = Math.max(1, Math.ceil(sessions.length / cols));
  const style: CSSProperties = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` };

  return (
    <div className="focus">
      <div className="focus-bar">
        <span className="muted">Fönster:</span>
        <button type="button" className="btn small" onClick={() => send('window:snap', { mode: 'left' })}>Vänster halva</button>
        <button type="button" className="btn small" onClick={() => send('window:snap', { mode: 'right' })}>Höger halva</button>
        <button type="button" className="btn small" onClick={() => send('window:snap', { mode: 'full' })}>Helskärm</button>
      </div>
      {sessions.length === 0 ? (
        <div className="empty-state">
          <p>Inget i Fokus just nu. En session kommer hit av sig själv när du skriver till den (eller dubbelklickar på kortet), och lämnar efter några dagar utan arbete.</p>
        </div>
      ) : (
        <div className="tile-grid" style={style}>
          {sessions.map((s) => <SessionTile key={s.id} session={s} />)}
        </div>
      )}
    </div>
  );
}
