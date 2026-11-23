import { useState, type CSSProperties } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { useTranscript } from '../state/useTranscript';
import { AgentDots, ModelEffortPicker, StatusChip } from './Atoms';
import { ChatInput } from './ChatInput';
import { ContextMeter } from './ContextMeter';
import { PendingPanel } from './PendingPanel';
import { SchemaButton } from './SchemaButton';
import { TranscriptView } from './TranscriptView';
import { WorkSchema } from './WorkSchema';

/** One focus-mode tile: coloured header, live transcript, pending input, message box. */
export function SessionTile({ session }: { session: SessionSummary }) {
  const entries = useTranscript(session.id);
  const [schemaOpen, setSchemaOpen] = useState(false);
  return (
    <section className="tile" style={{ '--accent': session.color } as CSSProperties}>
      <header className="tile-head">
        <span className="tile-name">{session.name}</span>
        <StatusChip status={session.status} />
        <ModelEffortPicker session={session} />
        <AgentDots count={session.activeAgents} color="#fff" />
        <SchemaButton session={session} onOpen={() => setSchemaOpen(true)} compact />
      </header>
      <div className="tile-context">
        <ContextMeter session={session} />
      </div>
      <TranscriptView entries={entries} sessionId={session.id} />
      <PendingPanel session={session} />
      <ChatInput session={session} />
      {schemaOpen && <WorkSchema session={session} onClose={() => setSchemaOpen(false)} />}
    </section>
  );
}
