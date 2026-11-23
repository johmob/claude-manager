import type { CSSProperties, MouseEvent } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { Spinner } from './Atoms';

/**
 * Opens the work schema and leads with what remains of the project: "12 punkter kvar", then how much
 * is done and how much is in progress. `compact` fits the Fokus tile's header.
 */
export function SchemaButton({ session, onOpen, compact }: { session: SessionSummary; onOpen: () => void; compact?: boolean }) {
  const { todo } = session;
  const open = (e: MouseEvent): void => {
    e.stopPropagation();
    onOpen();
  };
  const style = { '--accent': session.color } as CSSProperties;

  if (session.mapping || !todo) {
    const text = session.mapping ? 'Kartlägger projektet…' : 'Inget arbetsschema · kartlägg';
    return (
      <button type="button" className={compact ? 'schema-btn compact' : 'schema-btn'} data-state={session.mapping ? 'mapping' : 'empty'} style={style} onClick={open}>
        <span className="schema-btn-main">{session.mapping && <Spinner small />}{text}</span>
      </button>
    );
  }

  const left = todo.totalItems - todo.doneItems;
  const headline = left === 0 ? 'Allt klart' : `${left} ${left === 1 ? 'punkt' : 'punkter'} kvar`;
  const title = `Arbetsschema: ${left} av ${todo.totalItems} punkter kvar, ${todo.inProgressItems} pågår, ${todo.tracks.length} spår. Klicka för att öppna.`;
  return (
    <button type="button" className={compact ? 'schema-btn compact' : 'schema-btn'} data-done={left === 0 ? 'true' : undefined} style={style} title={title} onClick={open}>
      {!compact && <span className="schema-btn-label">Arbetsschema <span className="schema-btn-open">Öppna ›</span></span>}
      <span className="schema-btn-main">
        <strong>{headline}</strong>
        {!compact && todo.inProgressItems > 0 && <span className="schema-btn-detail">· {todo.inProgressItems} pågår</span>}
        <span className="schema-btn-pct"><b>{todo.progress} %</b> klart</span>
      </span>
      <span className="schema-btn-bar"><span style={{ width: `${todo.progress}%` }} /></span>
    </button>
  );
}
