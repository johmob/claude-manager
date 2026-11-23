import type { ReactNode } from 'react';
import type { ModelChoice, SessionStatus, TodoStatus } from '../../../shared/contracts';
import { MODEL_SHORT, STATUS_LABEL } from '../lib/format';

export function StatusChip({ status }: { status: SessionStatus }) {
  return (
    <span className="chip" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ModelBadge({ model }: { model: ModelChoice }) {
  return <span className="badge">{MODEL_SHORT[model]}</span>;
}

/** One dot per active agent, filled in the session colour. */
export function AgentDots({ count, color }: { count: number; color: string }) {
  if (count <= 0) return null;
  const dots = Array.from({ length: Math.min(count, 10) }, (_, i) => i);
  return (
    <span className="agent-dots" title={`${count} aktiva agenter`}>
      {dots.map((i) => (
        <span key={i} className="agent-dot" style={{ background: color }} />
      ))}
    </span>
  );
}

const TODO_ICON: Record<TodoStatus, string> = { not_started: '○', in_progress: '◐', done: '●' };

export function TodoIcon({ status }: { status: TodoStatus }) {
  return <span className="todo-icon" data-todo={status}>{TODO_ICON[status]}</span>;
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={small ? 'spinner small' : 'spinner'} />;
}

export function IconButton(props: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={props.active ? 'icon-btn active' : 'icon-btn'}
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
