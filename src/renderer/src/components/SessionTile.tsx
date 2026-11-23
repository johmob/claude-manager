import type { CSSProperties } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { useTranscript } from '../state/useTranscript';
import { AgentDots, ModelBadge, StatusChip } from './Atoms';
import { ChatInput } from './ChatInput';
import { PendingPanel } from './PendingPanel';
import { TranscriptView } from './TranscriptView';

/** One focus-mode tile: coloured header, live transcript, pending input, message box. */
export function SessionTile({ session }: { session: SessionSummary }) {
  const entries = useTranscript(session.id);
  return (
    <section className="tile" style={{ '--accent': session.color } as CSSProperties}>
      <header className="tile-head">
        <span className="tile-name">{session.name}</span>
        <StatusChip status={session.status} />
        <ModelBadge model={session.model} />
        <AgentDots count={session.activeAgents} color="#fff" />
      </header>
      <TranscriptView entries={entries} />
      <PendingPanel session={session} />
      <ChatInput session={session} />
    </section>
  );
}
