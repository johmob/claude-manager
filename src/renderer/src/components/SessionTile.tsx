import { useState, type CSSProperties } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { useTranscript } from '../state/useTranscript';
import { AgentDots, ModelEffortPicker, StatusChip } from './Atoms';
import { ChatInput } from './ChatInput';
import { ContextMeter } from './ContextMeter';
import { PendingPanel } from './PendingPanel';
import { QuestionsButton } from './QuestionFlow';
import { SchemaButton } from './SchemaButton';
import { TranscriptView } from './TranscriptView';
import { WorkSchema } from './WorkSchema';
import { SessionMark } from './SessionMark';

/** One focus-mode tile: header (name on its own row, controls below), live transcript, pending input, message box. */
export function SessionTile({ session }: { session: SessionSummary }) {
  const entries = useTranscript(session.id);
  const [schemaOpen, setSchemaOpen] = useState(false);
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
        </div>
      </header>
      <div className="tile-context">
        <ContextMeter session={session} />
      </div>
      <TranscriptView entries={entries} sessionId={session.id} />
      <QuestionsButton session={session} />
      <PendingPanel session={session} />
      <ChatInput session={session} />
      {schemaOpen && <WorkSchema session={session} onClose={() => setSchemaOpen(false)} />}
    </section>
  );
}
