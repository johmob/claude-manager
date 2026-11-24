import type { CSSProperties, ReactNode } from 'react';
import type { AccountSnapshot, SessionSummary } from '../../../shared/contracts';
import { EFFORT_LABEL, formatElapsed, formatTokenTotal, formatTokens } from '../lib/format';
import { useNow } from '../lib/useNow';
import { modelLabel } from '../state/account';
import { StatusChip } from './Atoms';

/** What a waiting session needs from the user, in one line. */
function waitingFor(session: SessionSummary): string | null {
  const p = session.pending;
  if (p) return p.kind === 'question' ? p.questions.map((q) => q.question).join(' · ') : `Behörighet: ${p.summary}`;
  const { questions } = session;
  if (!questions.length) return null;
  const first = questions[0]!.text;
  return questions.length === 1 ? first : `${questions.length} frågor. Första: ${first}`;
}

/** A labelled row: muted label on the left, the value on the right. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="si-label">{label}</span>
      <span className="si-value">{children}</span>
    </>
  );
}

/** A short bar with its text beside it. */
export function InfoBar({ percent, color, children }: { percent: number; color: string; children: ReactNode }) {
  return (
    <span className="si-bar-row">
      <span className="si-bar"><span style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: color } as CSSProperties} /></span>
      <span>{children}</span>
    </span>
  );
}

/** Context fill: calm below half, warning colours as it fills up. */
function contextColor(percent: number): string {
  if (percent >= 90) return '#ff3b30';
  if (percent >= 70) return '#ff8a1f';
  if (percent >= 50) return '#facc15';
  return '#5b9cff';
}

/** Everything worth knowing about a session at a glance: status, what it waits for, current work, agents, model, context, plan. */
export function SessionInfo({ session, account }: { session: SessionSummary; account: AccountSnapshot | null }) {
  const now = useNow(session.turnStartedAt !== null);
  const waiting = waitingFor(session);
  const { context, todo } = session;
  return (
    <div className="session-info" style={{ '--accent': session.color } as CSSProperties}>
      <div className="si-head">
        <span className="si-dot" />
        <strong className="si-name">{session.name}</strong>
        {session.turnStartedAt !== null && <span className="si-time">{formatElapsed(now - session.turnStartedAt)}</span>}
        <StatusChip status={session.status} compacting={session.compacting} />
      </div>
      {waiting && (
        <div className="si-wait">
          <span className="si-wait-title">Väntar på dig</span>
          {waiting}
        </div>
      )}
      <div className="si-grid">
        {(session.status === 'working' || session.activeAgents > 0) && session.currentTask && <InfoRow label="Just nu"><span className="si-task">{session.currentTask}</span></InfoRow>}
        <InfoRow label="Agenter">
          {session.agentCount ? (
            <>
              <b className={session.activeAgents > 0 ? 'si-busy' : undefined}>{session.activeAgents}</b> av {session.agentCount} jobbar
            </>
          ) : (
            <span className="si-dim">inte startad</span>
          )}
        </InfoRow>
        <InfoRow label="Modell">
          {modelLabel(account, session.model)} <span className="si-dim">· {EFFORT_LABEL[session.effort].toLowerCase()}</span>
        </InfoRow>
        <InfoRow label="Kontext">
          {context ? (
            <InfoBar percent={context.percentage} color={contextColor(context.percentage)}>
              {formatTokens(context.totalTokens)} <span className="si-dim">/ {formatTokens(context.maxTokens)}</span>
            </InfoBar>
          ) : (
            <span className="si-dim">–</span>
          )}
        </InfoRow>
        {todo && (
          <InfoRow label="Schema">
            <InfoBar percent={todo.progress} color={session.color}>
              {todo.progress} % <span className="si-dim">· {todo.doneItems}/{todo.totalItems}</span>
            </InfoBar>
          </InfoRow>
        )}
        <InfoRow label="Tokens">{formatTokenTotal(session.tokensUsed)}</InfoRow>
      </div>
    </div>
  );
}
