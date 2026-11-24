import { useState, type CSSProperties } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { useTranscript } from '../state/useTranscript';
import { AgentDots, ModelEffortPicker, StatusChip } from './Atoms';
import { ChatInput } from './ChatInput';
import { ContextMeter } from './ContextMeter';
import { PendingPanel } from './PendingPanel';
import { QuestionsButton } from './QuestionFlow';
import { SchemaButton } from './SchemaButton';
import { StatusLine, TranscriptView } from './TranscriptView';
import { WorkSchema } from './WorkSchema';
import { SessionMark } from './SessionMark';
import { DetailSwitch } from './DetailLevel';
import { DriftBar } from './DriftBar';
import { ChatDetailContext, useChatDetail } from '../state/chatDetail';

/** One focus-mode tile: header (name on its own row, controls below), live transcript, pending input, message box. */
export function SessionTile({ session }: { session: SessionSummary }) {
  const entries = useTranscript(session.id);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [detail, setDetail] = useChatDetail(session.id);
  return (
    <section className="tile" style={{ '--accent': session.color } as CSSProperties}>
      <header className="tile-head">
        <div className="tile-title">
          <SessionMark name={session.name} icon={session.icon} size={18} className="tile-mark" />
          <span className="tile-name" title={session.cwd}>{session.name}</span>
          <StatusChip status={session.status} />
        </div>
        <div className="tile-controls">
          <ModelEffortPicker session={session} />
          <AgentDots count={session.activeAgents} color={session.color} />
          <SchemaButton session={session} onOpen={() => setSchemaOpen(true)} compact />
          <DetailSwitch value={detail} onChange={setDetail} />
        </div>
      </header>
      <div className="tile-context">
        <ContextMeter session={session} />
      </div>
      <DriftBar session={session} />
      <ChatDetailContext.Provider value={detail}>
        <StatusLine entries={entries} />
        <TranscriptView entries={entries} sessionId={session.id} />
      </ChatDetailContext.Provider>
      <QuestionsButton session={session} />
      <PendingPanel session={session} />
      <ChatInput session={session} />
      {schemaOpen && <WorkSchema session={session} onClose={() => setSchemaOpen(false)} />}
    </section>
  );
}
