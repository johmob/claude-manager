import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';
import { useTranscript } from '../state/useTranscript';
import { Spinner } from './Atoms';
import { PlusIcon, SendIcon, TrashIcon } from './Icons';
import { MarkdownText } from './MarkdownText';
import { Modal } from './Modal';
import { PendingPanel } from './PendingPanel';

/** The quick chat's fixed session id (main keeps it off the cards). */
const QUICK_ID = 'quick';

/** The quick chat's live state (working, a permission request), or null before its first question. */
export function useQuickChat(): SessionSummary | null {
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  useEffect(() => {
    const off = window.cm.on('state:quick', setSummary);
    void window.cm.invoke('quick:current', undefined).then(setSummary);
    return off;
  }, []);
  return summary;
}

/** Short versions of long answers, by transcript entry id. */
function useQuickSummaries(): Record<string, string> {
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  useEffect(() => {
    const off = window.cm.on('state:quick-summaries', setSummaries);
    void window.cm.invoke('quick:summaries', undefined).then(setSummaries);
    return off;
  }, []);
  return summaries;
}

/** An answer: in the small panel its short version with "Visa mer" when there is one, otherwise in full. */
function QuickAnswer({ text, summary }: { text: string; summary: string | undefined }) {
  const [full, setFull] = useState(false);
  if (!summary || full) return <MarkdownText text={text} className="md quick-a" />;
  return (
    <div className="quick-a-short">
      <div className="quick-a">{summary}</div>
      <button type="button" className="link-btn" onClick={() => setFull(true)}>Visa mer</button>
    </div>
  );
}

/**
 * Quick questions, like a web search: the questions and answers so far and a box for the next one.
 * Follow-ups continue the conversation; "Ny fråga" starts over. Used in the "Ny chatt" window and
 * folded out under the chat button in the overlay.
 */
export function QuickChatBody({ compact = false, large = false }: { compact?: boolean; large?: boolean }) {
  const summary = useQuickChat();
  const short = useQuickSummaries();
  const [text, setText] = useState('');
  const entries = useTranscript(QUICK_ID);
  const log = useRef<HTMLDivElement>(null);
  const shown = entries.filter((e) => e.kind === 'user' || (e.kind === 'assistant' && e.text.trim()) || (e.kind === 'system' && e.level !== 'info'));
  const working = summary?.status === 'working' || summary?.status === 'starting';
  useLayoutEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [shown.length, working]);

  const ask = (): void => {
    const question = text.trim();
    if (!question) return;
    send('quick:ask', { text: question });
    setText('');
  };

  return (
    <div className={compact ? 'quick compact' : large ? 'quick large' : 'quick'}>
      {(shown.length > 0 || working) && (
        <div className="quick-log" ref={log}>
          {shown.map((e) =>
            e.kind === 'user' ? (
              <div key={e.id} className="quick-q">{e.text}</div>
            ) : e.kind === 'assistant' ? (
              compact ? <QuickAnswer key={e.id} text={e.text} summary={short[e.id]} /> : <MarkdownText key={e.id} text={e.text} className="md quick-a" />
            ) : e.kind === 'system' ? (
              <div key={e.id} className="quick-error">{e.text}</div>
            ) : null,
          )}
          {working && <div className="quick-working"><Spinner small /> Tänker…</div>}
        </div>
      )}
      {summary?.pending && <PendingPanel session={summary} />}
      <div className="quick-input">
        <input
          className="input"
          autoFocus
          placeholder={shown.length ? 'Följdfråga…' : 'Fråga vad som helst…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask();
          }}
        />
        <button type="button" className="btn primary quick-icon" title="Fråga (Enter)" aria-label="Fråga" disabled={!text.trim()} onClick={ask}><SendIcon /></button>
        {shown.length > 0 && (
          <>
            <button type="button" className="btn quick-icon" title="Ny fråga: nytt samtal, svaren hittills står kvar" aria-label="Ny fråga" onClick={() => send('quick:new', undefined)}><PlusIcon /></button>
            <button type="button" className="btn quick-icon" title="Ta bort: rensa chatten" aria-label="Ta bort" onClick={() => send('quick:reset', undefined)}><TrashIcon /></button>
          </>
        )}
      </div>
    </div>
  );
}

/** The quick chat in a window: small ("Ny chatt" in the main window) or large, for reading long answers. */
export function QuickChat({ onClose, large = false }: { onClose: () => void; large?: boolean }) {
  return (
    <Modal title="Snabbfråga" onClose={onClose} size={large ? 'full' : undefined}>
      <QuickChatBody large={large} />
    </Modal>
  );
}
