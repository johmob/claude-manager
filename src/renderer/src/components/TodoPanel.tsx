import type { SessionSummary } from '../../../shared/contracts';
import { formatElapsed, todoProgress } from '../lib/format';
import { useNow } from '../lib/useNow';
import { Modal } from './Modal';
import { StatusChip, TodoIcon } from './Atoms';

/** Todo tree of one session, live from state. */
export function TodoPanel({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const now = useNow(session.startedAt !== null);
  const { todo } = session;
  const progress = todo ? todoProgress(todo) : null;

  return (
    <Modal title={session.name} onClose={onClose} wide>
      <div className="todo-meta">
        <StatusChip status={session.status} />
        {session.startedAt !== null && <span className="muted">Tid sedan start {formatElapsed(now - session.startedAt)}</span>}
      </div>
      {session.currentTask && <div className="todo-activity">Aktivitet: {session.currentTask}</div>}
      {!todo || !progress ? (
        <div className="empty-text">Ingen planering ännu. Agenten skapar ett träd när den börjar arbeta.</div>
      ) : (
        <>
          <div className="todo-title">{todo.title}</div>
          <div className="todo-progress">
            <div className="thin-bar"><div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: session.color }} /></div>
            <span className="muted">{progress.done} / {progress.total}</span>
          </div>
          <ol className="todo-blocks">
            {todo.blocks.map((block) => (
              <li key={block.id} className="todo-block">
                <div className="todo-block-title"><TodoIcon status={block.status} /> {block.title}</div>
                <ul className="todo-steps">
                  {block.steps.map((step) => (
                    <li key={step.id} data-todo={step.status}><TodoIcon status={step.status} /> {step.title}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  );
}
