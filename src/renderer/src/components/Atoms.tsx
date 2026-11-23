import type { ReactNode } from 'react';
import type { EffortChoice, ModelChoice, SessionStatus, SessionSummary, TodoStatus } from '../../../shared/contracts';
import { send } from '../lib/api';
import { EFFORT_LABEL, STATUS_LABEL } from '../lib/format';
import { effortOptions, modelOptions, useAccount } from '../state/account';

export function StatusChip({ status }: { status: SessionStatus }) {
  return (
    <span className="chip" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The session's model and effort as two small selects, limited to what the account offers and what
 * the chosen model supports. A change applies to a running session at once.
 */
export function ModelEffortPicker({ session }: { session: SessionSummary }) {
  const models = modelOptions(useAccount(), session.model);
  return (
    <span className="picker" onClick={(e) => e.stopPropagation()}>
      <select
        className="badge-select"
        title="Modell"
        value={session.model}
        onChange={(e) => send('session:set-model', { id: session.id, model: e.target.value as ModelChoice })}
      >
        {models.map((m) => <option key={m.choice} value={m.choice}>{m.label}</option>)}
      </select>
      <select
        className="badge-select"
        title="Effort (hur grundligt modellen tänker)"
        value={session.effort}
        onChange={(e) => send('session:set-effort', { id: session.id, effort: e.target.value as EffortChoice })}
      >
        {effortOptions(models, session.model, session.effort).map((level) => (
          <option key={level} value={level}>Effort: {EFFORT_LABEL[level]}</option>
        ))}
      </select>
    </span>
  );
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
