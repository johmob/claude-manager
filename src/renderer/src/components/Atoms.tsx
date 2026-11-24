import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { FoldVertical } from 'lucide-react';
import '../styles/compacting.css';
import type { CompactProgress, EffortChoice, ModelChoice, SessionStatus, SessionSummary, TodoStatus } from '../../../shared/contracts';
import { send } from '../lib/api';
import { EFFORT_LABEL, STATUS_LABEL } from '../lib/format';
import { effortOptions, modelOptions, useAccount } from '../state/account';

export function StatusChip({ status, compacting }: { status: SessionStatus; compacting?: CompactProgress | null }) {
  if (compacting) return <CompactChip progress={compacting} />;
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
const MODEL_NAMES: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', default: 'Standard' };

/** "Opus", "Sonnet 5.5" or the model id as given; the main agent's model when a subagent names none. */
function modelName(model: string): string {
  return MODEL_NAMES[model] ?? (model.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase()) || 'Som huvudagenten');
}

const EFFORT_NAMES: Record<string, string> = { low: 'låg', medium: 'medel', high: 'hög', xhigh: 'extra hög', max: 'max', default: 'standard' };

function tokensText(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** The agents at work: one row each with model, effort and context or tokens so far, and what it is doing. */
function AgentList({ session }: { session: SessionSummary }) {
  return (
    <div className="agent-list" role="tooltip">
      {session.agents.map((agent) => (
        <div key={agent.id} className="agent-row" data-role={agent.role}>
          <div className="agent-row-head">
            <span className="agent-row-name">{agent.name}</span>
            {agent.agentType && <span className="agent-row-type">{agent.agentType}</span>}
          </div>
          <div className="agent-row-facts">
            <span>{modelName(agent.model)}</span>
            <span>{agent.effort ? `nivå ${EFFORT_NAMES[agent.effort] ?? agent.effort}` : 'nivå som huvudagenten'}</span>
            {agent.contextPercent !== null && <span>kontext {agent.contextPercent} %</span>}
            {agent.tokens !== null && <span>{tokensText(agent.tokens)} tokens</span>}
            {agent.toolUses > 0 && <span>{agent.toolUses} verktyg</span>}
          </div>
          {(agent.summary || agent.lastTool) && <div className="agent-row-doing">{agent.summary || `Senast: ${agent.lastTool}`}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * Agents at work, readable at a glance: a spinning ring, "Arbetar", and one dot per agent in a quick wave
 * (the count when there are several). Hovering shows each agent's model, effort, context and task.
 */
export function AgentDots({ session }: { session: SessionSummary }) {
  if (session.compacting) return null;
  const count = session.activeAgents;
  if (count <= 0) return null;
  const dots = Array.from({ length: Math.min(count, 10) }, (_, i) => i);
  return (
    <span className="agent-work" tabIndex={0} style={{ '--c': session.color } as CSSProperties}>
      <span className="agent-spin" aria-hidden />
      <span className="agent-work-text">Arbetar{count > 1 ? ` · ${count}` : ''}</span>
      <span className="agent-dots" aria-hidden>
        {dots.map((i) => (
          <span key={i} className="agent-dot" style={{ animationDelay: `${i * 0.12}s` }} />
        ))}
      </span>
      {session.agents.length > 0 && <AgentList session={session} />}
    </span>
  );
}

function clock(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** "cirka 1 minut", "cirka 3 minuter", "under en minut". */
function aboutText(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'under en minut';
  return `cirka ${min} ${min === 1 ? 'minut' : 'minuter'}`;
}

/**
 * Compacting the conversation: replaces the status text while it runs. Shows the time so far; the
 * tooltip says how long it usually takes (the stream reports no progress, so no share is shown).
 */
function CompactChip({ progress }: { progress: CompactProgress }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = now - progress.startedAt;
  const size = progress.preTokens ? ` ${Math.round(progress.preTokens / 1000)}k tokens.` : '';
  const slow = elapsed > progress.expectedMs * 1.5 ? ' Tar längre än vanligt.' : '';
  return (
    <span className="chip" data-status="compacting" title={`Komprimerar samtalet.${size} Det brukar ta ${aboutText(progress.expectedMs)}, uppskattat från kontextens storlek och tidigare komprimeringar.${slow}`}>
      <FoldVertical size={12} className="chip-compress" aria-hidden />
      Komprimerar {clock(elapsed)}
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
