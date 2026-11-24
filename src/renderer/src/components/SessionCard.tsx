import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { formatElapsed } from '../lib/format';
import { send } from '../lib/api';
import { useNow } from '../lib/useNow';
import { AgentDots, IconButton, ModelEffortPicker, Spinner, StatusChip } from './Atoms';
import { CalloutBox } from './CalloutBox';
import { ChatInput } from './ChatInput';
import { ContextMeter } from './ContextMeter';
import { PendingPanel } from './PendingPanel';
import { TaggedText } from './TaggedText';
import { SessionMark } from './SessionMark';
import { ChatDetailContext, useChatDetail } from '../state/chatDetail';
import { useTranscript } from '../state/useTranscript';
import { QuestionsButton } from './QuestionFlow';
import { SchemaButton } from './SchemaButton';

interface SessionCardProps {
  session: SessionSummary;
  onOpen: () => void;
  /** Few cards share the window: show the latest answer and a larger message box. */
  roomy?: boolean;
}

/** The main agent's latest answer, for a card with room to show it. */
function LatestAnswer({ sessionId }: { sessionId: string }) {
  const entries = useTranscript(sessionId);
  const [detail] = useChatDetail(sessionId);
  const latest = [...entries].reverse().find((e) => e.kind === 'assistant' && !e.agentId && !e.held && e.text.trim());
  if (!latest || latest.kind !== 'assistant') return <div className="card-latest card-latest-empty">Inget svar ännu.</div>;
  return (
    <div className="card-latest">
      <ChatDetailContext.Provider value={detail}>
        <TaggedText text={latest.text} blocks={latest.blocks} />
      </ChatDetailContext.Provider>
    </div>
  );
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

/** " Fortsätter 18:30." for a session stopped by the usage limit. */
function limitNote(session: SessionSummary): string {
  if (session.status !== 'limited') return '';
  const at = session.limitResetsAt ? new Date(session.limitResetsAt) : null;
  return at ? ` Fortsätter ${at.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}.` : ' Fortsätter när gränsen har återställts.';
}

/** What the latest turn tagged (suggestions stay in the transcript), until dismissed. */
function CardCallouts({ session }: { session: SessionSummary }) {
  // Questions and assumptions are answered in the question flow (the button above), so they are not repeated here.
  const shown = session.callouts.filter((c) => c.kind !== 'tip' && !(session.questions.length && (c.kind === 'question' || c.kind === 'note')));
  if (!shown.length) return null;
  return (
    <div className="card-callouts">
      <IconButton title="Avfärda" onClick={() => send('session:dismiss-callouts', { id: session.id })}>×</IconButton>
      {shown.map((callout, i) => <CalloutBox key={i} callout={callout} sessionId={session.id} />)}
    </div>
  );
}

export function SessionCard({ session, onOpen, roomy = false }: SessionCardProps) {
  const [renaming, setRenaming] = useState(false);
  const working = session.status === 'working' && session.turnStartedAt !== null;
  const now = useNow(working);

  return (
    <article className={roomy ? 'card roomy' : 'card'} data-status={session.status} data-expanded={session.pending ? 'true' : 'false'} style={{ '--accent': session.color } as CSSProperties}>
      <div className="card-strip" />
      <div className="card-main">
        <div className="card-top">
          <SessionMark name={session.name} icon={session.icon} size={18} className="card-mark" />
          {renaming ? <RenameField session={session} onDone={() => setRenaming(false)} /> : <span className="card-name" title={session.cwd}>{session.name}</span>}
          <StatusChip status={session.status} />
        </div>
        <div className="card-sub">
          <ModelEffortPicker session={session} />
          <AgentDots count={session.activeAgents} color={session.color} />
          {working && session.turnStartedAt !== null && <span className="elapsed">{formatElapsed(now - session.turnStartedAt)}</span>}
        </div>
        <div className="card-task">{session.mapping ? <><Spinner small /> Kartlägger projektet…</> : session.currentTask || " "}</div>
        <SchemaButton session={session} onOpen={onOpen} />
        <ContextMeter session={session} />
        {session.lastError && <div className="card-error">{session.lastError}{limitNote(session)}</div>}
      </div>
      {roomy && <LatestAnswer sessionId={session.id} />}
      <QuestionsButton session={session} />
      <CardCallouts session={session} />
      <PendingPanel session={session} />
      {!session.pending && (
        <div className="card-input">
          <ChatInput session={session} compact={!roomy} />
        </div>
      )}
      <div className="card-foot">
        <button type="button" className="btn small card-open" onClick={() => send('window:show-session', { id: session.id })}>Öppna chatten</button>
        <CardActions session={session} onRename={() => setRenaming(true)} />
      </div>
    </article>
  );
}
