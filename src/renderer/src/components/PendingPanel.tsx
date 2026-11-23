import { useState } from 'react';
import type {
  PendingPermission,
  PendingQuestion,
  QuestionAnswers,
  QuestionItem,
  SessionSummary,
} from '../../../shared/contracts';
import { send } from '../lib/api';

interface QuestionState {
  picked: string[];
  other: string;
}

const EMPTY: QuestionState = { picked: [], other: '' };

function answerFor(s: QuestionState): string {
  const free = s.other.trim();
  return free || s.picked.join(', ');
}

function QuestionBlock(props: {
  item: QuestionItem;
  state: QuestionState;
  onChange: (s: QuestionState) => void;
}) {
  const { item, state, onChange } = props;
  const pick = (label: string): void => {
    const has = state.picked.includes(label);
    const picked = item.multiSelect
      ? has ? state.picked.filter((l) => l !== label) : [...state.picked, label]
      : has ? [] : [label];
    onChange({ ...state, picked });
  };
  const overridden = state.other.trim() !== '';
  return (
    <div className="q-block">
      <div className="q-head">
        <span className="q-chip">{item.header}</span>
        <span className="q-text">{item.question}</span>
      </div>
      <div className="q-options">
        {item.options.map((o) => (
          <button
            type="button"
            key={o.label}
            className={state.picked.includes(o.label) && !overridden ? 'q-option selected' : 'q-option'}
            title={o.description}
            onClick={() => pick(o.label)}
          >
            <span className="q-option-label">{o.label}</span>
            {o.description && <span className="q-option-desc">{o.description}</span>}
          </button>
        ))}
      </div>
      <input
        className="input"
        placeholder="Annat…"
        value={state.other}
        onChange={(e) => onChange({ ...state, other: e.target.value })}
      />
    </div>
  );
}

function QuestionForm({ sessionId, pending }: { sessionId: string; pending: PendingQuestion }) {
  const [states, setStates] = useState<Record<string, QuestionState>>({});
  const get = (q: string): QuestionState => states[q] ?? EMPTY;
  const ready = pending.questions.every((q) => answerFor(get(q.question)) !== '');

  const submit = (): void => {
    const answers: QuestionAnswers = {};
    for (const q of pending.questions) answers[q.question] = answerFor(get(q.question));
    send('session:answer', { id: sessionId, requestId: pending.requestId, answers });
  };

  return (
    <div className="pending question">
      {pending.questions.map((q) => (
        <QuestionBlock
          key={q.question}
          item={q}
          state={get(q.question)}
          onChange={(s) => setStates((prev) => ({ ...prev, [q.question]: s }))}
        />
      ))}
      <div className="pending-actions">
        <button type="button" className="btn primary" disabled={!ready} onClick={submit}>Skicka</button>
      </div>
    </div>
  );
}

function PermissionForm({ sessionId, pending }: { sessionId: string; pending: PendingPermission }) {
  const decide = (decision: 'allow' | 'deny'): void =>
    send('session:permission', { id: sessionId, requestId: pending.requestId, decision });
  return (
    <div className="pending permission">
      <div className="perm-summary">{pending.summary}</div>
      {pending.detail && <pre className="perm-detail">{pending.detail}</pre>}
      <div className="pending-actions">
        <button type="button" className="btn primary" onClick={() => decide('allow')}>Godkänn</button>
        <button type="button" className="btn danger" onClick={() => decide('deny')}>Neka</button>
      </div>
    </div>
  );
}

/** Inline answer UI for the oldest pending question or permission request of a session. */
export function PendingPanel({ session }: { session: SessionSummary }) {
  const { pending } = session;
  if (!pending) return null;
  const extra = session.pendingCount > 1 ? <div className="pending-more">+{session.pendingCount - 1} till</div> : null;
  return (
    <div className="pending-wrap" onClick={(e) => e.stopPropagation()}>
      {pending.kind === 'question' ? (
        <QuestionForm key={pending.requestId} sessionId={session.id} pending={pending} />
      ) : (
        <PermissionForm key={pending.requestId} sessionId={session.id} pending={pending} />
      )}
      {extra}
    </div>
  );
}
