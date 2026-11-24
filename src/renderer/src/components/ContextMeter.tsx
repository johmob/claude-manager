import { FoldVertical } from 'lucide-react';
import '../styles/compact-check.css';
import { CONTEXT_WINDOW_CHOICES, type ContextWindowChoice, type SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';
import { formatTokenTotal, formatTokens } from '../lib/format';

/** Fill level of the context bar: green, yellow from half full, orange near the window. */
function fillLevel(percentage: number): 'low' | 'mid' | 'high' {
  if (percentage >= 80) return 'high';
  return percentage >= 50 ? 'mid' : 'low';
}

/**
 * How full the session's context window is, the window size (when Claude Code compacts on its own),
 * a button to compact now, and the tokens the session has used so far.
 */
export function ContextMeter({ session }: { session: SessionSummary }) {
  const ctx = session.context;
  const pct = ctx ? Math.min(100, Math.round(ctx.percentage)) : 0;
  const setWindow = (value: string): void => {
    const window: ContextWindowChoice = value === 'auto' ? 'auto' : Number(value);
    send('session:set-context-window', { id: session.id, window });
  };
  const check = session.compactCheck;
  const preparing = check?.state === 'preparing';
  return (
    <div className="context-meter" onClick={(e) => e.stopPropagation()}>
      <div className="context-top">
        <span
          className="context-label"
          title={ctx ? `${ctx.totalTokens.toLocaleString('sv-SE')} av ${ctx.maxTokens.toLocaleString('sv-SE')} tokens i kontexten` : 'Mäts när sessionen körs'}
        >
          Kontext {ctx ? `${formatTokens(ctx.totalTokens)} / ${formatTokens(ctx.maxTokens)}` : '–'}
        </span>
        <span className="context-bar">
          <span data-level={fillLevel(pct)} style={{ width: `${pct}%` }} />
        </span>
      </div>
      <div className="context-actions">
        <select
          className="badge-select"
          title="Kontextfönster: hur stort samtalet får bli innan det komprimeras automatiskt. En körande session startas om med samma samtal."
          value={String(session.contextWindow)}
          onChange={(e) => setWindow(e.target.value)}
        >
          {CONTEXT_WINDOW_CHOICES.map((w) => (
            <option key={String(w)} value={String(w)}>Fönster: {w === 'auto' ? 'auto' : formatTokens(w)}</option>
          ))}
        </select>
        <button
          type="button"
          className="mini-btn"
          disabled={preparing || session.status === 'working'}
          title="Agenten får först spara det som måste överleva; när den är redo komprimeras samtalet (/compact)"
          onClick={() => send('session:compact', { id: session.id, action: 'prepare' })}
        >
          <FoldVertical size={13} aria-hidden /> {preparing ? 'Förbereder…' : 'Komprimera'}
        </button>
        <span className="context-tokens" title="Tokens som sessionen har förbrukat: in, ut och cache, alla turer">
          {formatTokenTotal(session.tokensUsed)} tokens
        </span>
      </div>
      {check?.state === 'unclear' && (
        <div className="compact-unclear">
          <span>Oklart om agenten är redo: {check.reason}</span>
          <button type="button" className="mini-btn" onClick={() => send('session:compact', { id: session.id, action: 'now' })}>Komprimera nu</button>
          <button type="button" className="mini-btn" onClick={() => send('session:compact', { id: session.id, action: 'cancel' })}>Låt bli</button>
        </div>
      )}
    </div>
  );
}
