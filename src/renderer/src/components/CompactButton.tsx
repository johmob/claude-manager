import { FoldVertical, LoaderCircle } from 'lucide-react';
import '../styles/chat-input.css';
import type { SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';
import { formatTokens } from '../lib/format';

/** Icon button that compacts the conversation: the agent first saves what must survive, then /compact. */
export function CompactButton({ session, label = false }: { session: SessionSummary; label?: boolean }) {
  const ctx = session.context;
  const pct = ctx ? Math.min(100, Math.round(ctx.percentage)) : 0;
  const preparing = session.compactCheck?.state === 'preparing';
  const disabled = preparing || !!session.compacting || !!session.compactCheck || session.status === 'working';
  const level = pct >= 85 ? 'critical' : pct >= 70 ? 'warn' : undefined;
  const usage = ctx ? ` · Kontext ${formatTokens(ctx.totalTokens)} / ${formatTokens(ctx.maxTokens)} (${pct} %)` : '';
  const title = preparing
    ? 'Agenten förbereder komprimeringen…'
    : `Komprimera: agenten sparar först det som måste överleva, sedan /compact${usage}`;
  return (
    <button
      type="button"
      className={label ? 'compact-btn with-label' : 'compact-btn'}
      data-level={level}
      disabled={disabled}
      title={title}
      aria-label="Komprimera samtalet"
      onClick={(e) => {
        e.stopPropagation();
        send('session:compact', { id: session.id, action: 'prepare' });
      }}
    >
      {preparing ? <LoaderCircle size={15} className="compact-spin" aria-hidden /> : <FoldVertical size={15} aria-hidden />}
      {label && <span>{preparing ? 'Förbereder…' : 'Komprimera'}</span>}
    </button>
  );
}
