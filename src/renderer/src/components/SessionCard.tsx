import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { formatCost, formatElapsed, todoProgress } from '../lib/format';
import { send } from '../lib/api';
import { useNow } from '../lib/useNow';
import { AgentDots, IconButton, ModelBadge, StatusChip } from './Atoms';
import { PendingPanel } from './PendingPanel';

interface SessionCardProps {
  session: SessionSummary;
  selected: boolean;
  selectDisabled: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}

function RenameField({ session, onDone }: { session: SessionSummary; onDone: () => void }) {
  const [value, setValue] = useState(session.name);
  const commit = (): void => {
    const name = value.trim();
    if (name && name !== session.name) send('session:rename', { id: session.id, name });
    onDone();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') onDone();
  };
  return (
    <input
      className="input rename"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKey}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function CardActions({ session, onRename }: { session: SessionSummary; onRename: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="card-actions confirm" onClick={(e) => e.stopPropagation()}>
        <span className="muted">Arkivera?</span>
        <button type="button" className="btn small danger" onClick={() => send('session:archive', { id: session.id })}>Ja</button>
        <button type="button" className="btn small" onClick={() => setConfirming(false)}>Nej</button>
      </div>
    );
  }
  return (
    <div className="card-actions" onClick={(e) => e.stopPropagation()}>
      {session.resumable && (
        <IconButton title="Återuppta" onClick={() => send('session:resume', { id: session.id })}>▶</IconButton>
      )}
      <IconButton title="Byt namn" onClick={onRename}>✎</IconButton>
      <IconButton title="Arkivera" onClick={() => setConfirming(true)}>🗄</IconButton>
    </div>
  );
}

function HeadsUpBox({ session }: { session: SessionSummary }) {
  if (!session.headsUp) return null;
  return (
    <div className="heads-up" role="note">
      <div className="heads-up-top">
        <span className="heads-up-label">Bra att veta</span>
        <IconButton title="Avfärda" onClick={() => send('session:dismiss-heads-up', { id: session.id })}>×</IconButton>
      </div>
      <strong>{session.headsUp.title}</strong>
      <p>{session.headsUp.text}</p>
    </div>
  );
}

export function SessionCard({ session, selected, selectDisabled, onToggleSelect, onOpen }: SessionCardProps) {
  const [renaming, setRenaming] = useState(false);
  const working = session.status === 'working' && session.turnStartedAt !== null;
  const now = useNow(working);
  const progress = session.todo ? todoProgress(session.todo) : null;
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <article className="card" data-status={session.status} data-expanded={session.pending ? 'true' : 'false'} style={{ '--accent': session.color } as CSSProperties}>
      <div className="card-strip" />
      <div className="card-main" onClick={onOpen}>
        <div className="card-top">
          <span className="name-dot" />
          {renaming ? <RenameField session={session} onDone={() => setRenaming(false)} /> : <span className="card-name" title={session.cwd}>{session.name}</span>}
          <StatusChip status={session.status} />
        </div>
        <div className="card-sub">
          <ModelBadge model={session.model} />
          <AgentDots count={session.activeAgents} color={session.color} />
          {working && session.turnStartedAt !== null && <span className="elapsed">{formatElapsed(now - session.turnStartedAt)}</span>}
          <span className="spacer" />
          <span className="muted small-text">{formatCost(session.costUsd)}</span>
        </div>
        <div className="card-task">{session.currentTask || ' '}</div>
        {progress && (
          <div className="thin-bar" title={`${progress.done} / ${progress.total}`}>
            <div style={{ width: `${pct}%`, background: session.color }} />
          </div>
        )}
        {session.lastError && <div className="card-error">{session.lastError}</div>}
      </div>
      <HeadsUpBox session={session} />
      <PendingPanel session={session} />
      <div className="card-foot">
        <label className="select-box" title={selectDisabled && !selected ? 'Max 6 i fokusläget' : 'Visa i Fokus'} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} disabled={selectDisabled && !selected} onChange={onToggleSelect} />
          <span>Fokus</span>
        </label>
        <CardActions session={session} onRename={() => setRenaming(true)} />
      </div>
    </article>
  );
}
