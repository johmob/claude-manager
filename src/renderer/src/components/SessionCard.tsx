import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { formatCost, formatElapsed } from '../lib/format';
import { send } from '../lib/api';
import { useNow } from '../lib/useNow';
import { AgentDots, IconButton, ModelEffortPicker, StatusChip } from './Atoms';
import { CalloutBox } from './CalloutBox';
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

/** What the latest turn tagged (suggestions stay in the transcript), until dismissed. */
function CardCallouts({ session }: { session: SessionSummary }) {
  const shown = session.callouts.filter((c) => c.kind !== 'tip');
  if (!shown.length) return null;
  return (
    <div className="card-callouts">
      <IconButton title="Avfärda" onClick={() => send('session:dismiss-callouts', { id: session.id })}>×</IconButton>
      {shown.map((callout, i) => <CalloutBox key={i} callout={callout} />)}
    </div>
  );
}

export function SessionCard({ session, selected, selectDisabled, onToggleSelect, onOpen }: SessionCardProps) {
  const [renaming, setRenaming] = useState(false);
  const working = session.status === 'working' && session.turnStartedAt !== null;
  const now = useNow(working);
  const { todo } = session;

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
          <ModelEffortPicker session={session} />
          <AgentDots count={session.activeAgents} color={session.color} />
          {working && session.turnStartedAt !== null && <span className="elapsed">{formatElapsed(now - session.turnStartedAt)}</span>}
          <span className="spacer" />
          <span className="muted small-text">{formatCost(session.costUsd)}</span>
        </div>
        <div className="card-task">{session.currentTask || ' '}</div>
        {todo && (
          <div className="thin-bar" title={`${todo.progress} % · ${todo.doneItems} av ${todo.totalItems} punkter · ${todo.tracks.length} spår`}>
            <div style={{ width: `${todo.progress}%`, background: session.color }} />
          </div>
        )}
        {session.lastError && <div className="card-error">{session.lastError}</div>}
      </div>
      <CardCallouts session={session} />
      <PendingPanel session={session} />
      <div className="card-foot">
        <label className="select-box" title={selectDisabled && !selected ? 'Max 6 i fokusläget' : 'Visa i Fokus'} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} disabled={selectDisabled && !selected} onChange={onToggleSelect} />
          <span>Fokus</span>
        </label>
        <button type="button" className="link-btn" onClick={onOpen}>Arbetsschema</button>
        <CardActions session={session} onRename={() => setRenaming(true)} />
      </div>
    </article>
  );
}
