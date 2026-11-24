import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { whenText, type SessionSummary } from '../../../shared/contracts';
import { formatElapsed } from '../lib/format';
import { send } from '../lib/api';
import { useNow } from '../lib/useNow';
import { AgentDots, IconButton, ModelEffortPicker, Spinner, StatusChip } from './Atoms';
import { CalloutBox } from './CalloutBox';
import { ChatInput } from './ChatInput';
import { ContextMeter } from './ContextMeter';
import { PendingPanel } from './PendingPanel';
import { SessionMark } from './SessionMark';
import { DriftBar } from './DriftBar';
import { QuestionsButton } from './QuestionBox';
import { SchemaButton } from './SchemaButton';

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
        <span className="muted" title="Projektets filer och Claudes sparade samtal finns kvar">Ta bort kortet?</span>
        <button type="button" className="btn small danger" onClick={() => send('session:delete', { id: session.id })}>Ta bort</button>
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
      <IconButton title="Ta bort kortet" onClick={() => setConfirming(true)}>🗑</IconButton>
    </div>
  );
}

/** " Fortsätter kl 18:30." (or "fre 28 nov kl 09:00" when not today) for a session stopped by the usage limit. */
function limitNote(session: SessionSummary): string {
  if (session.status !== 'limited') return '';
  const when = session.limitResetsAt ? whenText(session.limitResetsAt) : '';
  return when ? ` Fortsätter ${when}.` : ' Fortsätter när gränsen har återställts.';
}

/** What the latest turn tagged (suggestions stay in the transcript), until dismissed. */
function CardCallouts({ session }: { session: SessionSummary }) {
  // Questions and assumptions are answered in the chat (the button above opens it at the questions), so they are not repeated here.
  const shown = session.callouts.filter((c) => c.kind !== 'tip' && !(session.questions.length && (c.kind === 'question' || c.kind === 'note')));
  if (!shown.length) return null;
  return (
    <div className="card-callouts">
      <IconButton title="Avfärda" onClick={() => send('session:dismiss-callouts', { id: session.id })}>×</IconButton>
      {shown.map((callout, i) => <CalloutBox key={i} callout={callout} sessionId={session.id} />)}
    </div>
  );
}

export function SessionCard({ session, onOpen }: SessionCardProps) {
  const [renaming, setRenaming] = useState(false);
  const working = session.status === 'working' && session.turnStartedAt !== null;
  const now = useNow(working);

  return (
    <article className="card" data-status={session.status} data-expanded={session.pending ? 'true' : 'false'} style={{ '--accent': session.color } as CSSProperties}>
      <div className="card-strip" />
      <div className="card-main">
        <div className="card-top">
          <SessionMark name={session.name} icon={session.icon} size={18} className="card-mark" />
          {renaming ? <RenameField session={session} onDone={() => setRenaming(false)} /> : <span className="card-name" title={session.cwd}>{session.name}</span>}
          <StatusChip status={session.status} />
        </div>
        <div className="card-sub">
          <ModelEffortPicker session={session} />
          <AgentDots session={session} />
          {working && session.turnStartedAt !== null && <span className="elapsed">{formatElapsed(now - session.turnStartedAt)}</span>}
        </div>
        <div className="card-task">{session.mapping ? <><Spinner small /> Kartlägger projektet…</> : session.currentTask || " "}</div>
        <SchemaButton session={session} onOpen={onOpen} />
        <ContextMeter session={session} />
        {session.lastError && <div className="card-error">{session.lastError}{limitNote(session)}</div>}
      </div>
      <DriftBar session={session} />
      <QuestionsButton session={session} />
      <CardCallouts session={session} />
      <PendingPanel session={session} />
      {!session.pending && (
        <div className="card-input">
          <ChatInput session={session} compact />
        </div>
      )}
      <div className="card-foot">
        <button type="button" className="btn small card-open" onClick={() => send('window:show-session', { id: session.id })}>Öppna chatten</button>
        <CardActions session={session} onRename={() => setRenaming(true)} />
      </div>
    </article>
  );
}
