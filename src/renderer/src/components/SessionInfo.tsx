import type { AccountSnapshot, SessionSummary } from '../../../shared/contracts';
import { EFFORT_LABEL, formatElapsed, formatTokenTotal, formatTokens } from '../lib/format';
import { useNow } from '../lib/useNow';
import { modelLabel } from '../state/account';
import { StatusChip } from './Atoms';

/** What a waiting session needs from the user, in one line. */
function waitingFor(session: SessionSummary): string | null {
  const p = session.pending;
  if (!p) return null;
  return p.kind === 'question' ? p.questions.map((q) => q.question).join(' · ') : `Behörighet: ${p.summary}`;
}

/** Everything worth knowing about a session at a glance: status, current work, agents, model, context, plan. */
export function SessionInfo({ session, account }: { session: SessionSummary; account: AccountSnapshot | null }) {
  const now = useNow(session.turnStartedAt !== null);
  const waiting = waitingFor(session);
  return (
    <div className="session-info">
      <div className="si-head">
        <span className="si-dot" style={{ background: session.color }} />
        <strong>{session.name}</strong>
        <StatusChip status={session.status} />
        {session.turnStartedAt !== null && <span className="muted">{formatElapsed(now - session.turnStartedAt)}</span>}
      </div>
      {waiting && <div className="si-wait">Väntar på dig: {waiting}</div>}
      {session.currentTask && <div>Just nu: {session.currentTask}</div>}
      <div>
        Agenter: {session.activeAgents} aktiva · {modelLabel(account, session.model)} · effort {EFFORT_LABEL[session.effort].toLowerCase()}
      </div>
      <div>
        Kontext {session.context ? `${formatTokens(session.context.totalTokens)} / ${formatTokens(session.context.maxTokens)}` : '–'} ·{' '}
        {formatTokenTotal(session.tokensUsed)} tokens
      </div>
      {session.todo && (
        <div>
          Arbetsschema {session.todo.progress} % · {session.todo.doneItems} av {session.todo.totalItems} punkter
        </div>
      )}
    </div>
  );
}
