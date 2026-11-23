import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { formatElapsed } from '../lib/format';
import { send } from '../lib/api';
import { useNow } from '../lib/useNow';
import { AgentDots, IconButton, ModelEffortPicker, StatusChip } from './Atoms';
import { CalloutBox } from './CalloutBox';
import { ChatInput } from './ChatInput';
import { ContextMeter } from './ContextMeter';
import { PendingPanel } from './PendingPanel';

interface SessionCardProps {
  session: SessionSummary;
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

/** How long to wait for a second click before treating a click as a single click. */
const DOUBLE_CLICK_MS = 250;

/** Click handlers that run `single` on a click, or only `double` when a second click follows quickly. */
function useSingleOrDoubleClick(single: () => void, double: () => void) {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    onClick: () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(single, DOUBLE_CLICK_MS);
    },
    onDoubleClick: () => {
      window.clearTimeout(timer.current);
      double();
    },
  };
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

export function SessionCard({ session, onOpen }: SessionCardProps) {
  const [renaming, setRenaming] = useState(false);
  const working = session.status === 'working' && session.turnStartedAt !== null;
  const now = useNow(working);
  const { todo } = session;
  const clicks = useSingleOrDoubleClick(onOpen, () => send('window:show-session', { id: session.id }));

  return (
    <article className="card" data-status={session.status} data-expanded={session.pending ? 'true' : 'false'} style={{ '--accent': session.color } as CSSProperties}>
      <div className="card-strip" />
      <div className="card-main" title="Klicka: arbetsschema · Dubbelklicka: öppna i Fokus" {...clicks}>
        <div className="card-top">
          <span className="name-dot" />
          {renaming ? <RenameField session={session} onDone={() => setRenaming(false)} /> : <span className="card-name" title={session.cwd}>{session.name}</span>}
          <StatusChip status={session.status} />
        </div>
        <div className="card-sub">
          <ModelEffortPicker session={session} />
          <AgentDots count={session.activeAgents} color={session.color} />
          {working && session.turnStartedAt !== null && <span className="elapsed">{formatElapsed(now - session.turnStartedAt)}</span>}
        </div>
        <div className="card-task">{session.currentTask || ' '}</div>
        {todo && (
          <div className="thin-bar" title={`${todo.progress} % · ${todo.doneItems} av ${todo.totalItems} punkter · ${todo.tracks.length} spår`}>
            <div style={{ width: `${todo.progress}%`, background: session.color }} />
          </div>
        )}
        <ContextMeter session={session} />
        {session.lastError && <div className="card-error">{session.lastError}</div>}
      </div>
      <CardCallouts session={session} />
      <PendingPanel session={session} />
      {!session.pending && (
        <div className="card-input">
          <ChatInput session={session} compact />
        </div>
      )}
      <div className="card-foot">
        <label className="select-box" title="Kommer med i Fokus automatiskt när du skriver till den, och lämnar efter några dagar utan arbete" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={session.focused} onChange={() => send('session:set-focus', { id: session.id, focused: !session.focused })} />
          <span>Fokus</span>
        </label>
        <button type="button" className="link-btn" onClick={onOpen}>Arbetsschema</button>
        <CardActions session={session} onRename={() => setRenaming(true)} />
      </div>
    </article>
  );
}
