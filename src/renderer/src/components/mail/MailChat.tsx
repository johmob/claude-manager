import { useLayoutEffect, useRef, useState } from 'react';
import type { MailAddress, MailDraftView, MailItemView, TranscriptEntry } from '../../../../shared/contracts';
import { splitAppContext } from '../../../../shared/contracts';
import { errorMessage, send } from '../../lib/api';
import { useTranscript } from '../../state/useTranscript';
import '../../styles/mail-case.css';
import { Spinner } from '../Atoms';
import { MarkdownText } from '../MarkdownText';
import { MailDraft } from './MailDraft';

interface MailChatProps {
  item: MailItemView;
  sessionId: string;
  draft: MailDraftView | null;
  from: MailAddress;
  others: MailAddress[];
  onClose: () => void;
}

type Line =
  | { id: string; kind: 'note'; text: string }
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'agent'; text: string }
  | { id: string; kind: 'error'; text: string };

const COMMENT = /^Användarens kommentar:\n([\s\S]*?)\n\nSkriv om utkastet/;

/**
 * What the chat shows of the transcript. The mail agent's transcript starts with the app's own message (the
 * mail as data and the task): that, and every other app-written message, is folded to a quiet one-line note;
 * tool use is left out. Only what the user wrote and what the agent answers is shown in full.
 */
function chatLines(entries: TranscriptEntry[]): Line[] {
  const lines: Line[] = [];
  for (const e of entries) {
    if (e.kind === 'user') {
      if (e.text.includes('<mail-data>')) {
        lines.push({ id: e.id, kind: 'note', text: 'Mejlet och uppdraget gavs till agenten' });
        continue;
      }
      const { shown, notes } = splitAppContext(e.text);
      const comment = COMMENT.exec(shown)?.[1]?.trim();
      if (comment) lines.push({ id: e.id, kind: 'user', text: `Kommentar på utkastet: ${comment}` });
      else if (shown.trim()) lines.push({ id: e.id, kind: 'user', text: shown });
      else if (notes.length) lines.push({ id: e.id, kind: 'note', text: notes.join(' · ') });
    } else if (e.kind === 'assistant') {
      if (e.text.trim()) lines.push({ id: e.id, kind: 'agent', text: e.text });
    } else if (e.kind === 'system' && e.level !== 'info') {
      lines.push({ id: e.id, kind: 'error', text: e.text });
    }
  }
  return lines;
}

/**
 * "Prata igenom": a talk with the thread's mail agent next to the original mail. The plain quick-chat style
 * is used, not the work transcript with tags and folding, which is made for coding sessions. A draft the agent
 * proposes shows above the input with the same Skicka / Ändra med kommentar / Avstå choices.
 */
export function MailChat({ item, sessionId, draft, from, others, onClose }: MailChatProps) {
  const entries = useTranscript(sessionId);
  const lines = chatLines(entries);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const working = item.agent === 'working' || item.draft === 'writing';
  useLayoutEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines.length, working]);

  const ask = (): void => {
    const t = text.trim();
    if (!t) return;
    setText('');
    setError('');
    window.cm.invoke('mail:chat', { mailId: item.id, text: t }).catch((e: unknown) => setError(errorMessage(e)));
  };

  const showDraft = !!draft && (draft.status === 'proposed' || draft.status === 'writing' || draft.status === 'failed');

  return (
    <div className="mch">
      <div className="mch-log" ref={log}>
        {lines.length === 0 && !working && <div className="mdr-muted">Agenten har inte svarat ännu.</div>}
        {lines.map((l) =>
          l.kind === 'note' ? (
            <div key={l.id} className="mch-note">{l.text}</div>
          ) : l.kind === 'user' ? (
            <div key={l.id} className="mch-q">{l.text}</div>
          ) : l.kind === 'error' ? (
            <div key={l.id} className="mm-error">{l.text}</div>
          ) : (
            <MarkdownText key={l.id} text={l.text} className="md mch-a" />
          ),
        )}
        {working && <div className="mch-working"><Spinner small /> Agenten jobbar…</div>}
        {item.agent === 'error' && <div className="mm-error">Agenten stannade på ett fel. Skriv något för att försöka igen.</div>}
      </div>
      {showDraft && (
        <div className="mch-draft">
          <MailDraft mailId={item.id} draft={draft} writing={item.draft === 'writing'} from={from} others={others} compact onFinished={onClose} />
        </div>
      )}
      {error && <div className="mm-error" role="alert">{error}</div>}
      <div className="mch-input">
        <textarea
          className="input"
          rows={2}
          autoFocus
          placeholder="Skriv till agenten… (Retur skickar, Skift+Retur ny rad)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
        />
        <div className="mch-buttons">
          <button type="button" className="btn primary" disabled={!text.trim()} onClick={ask}>Skicka till agenten</button>
          <button
            type="button"
            className="btn"
            title="Du är färdig med mejlet: det markeras som hanterat och som läst i Outlook"
            onClick={() => {
              send('mail:act', { mailId: item.id, action: 'done' });
              onClose();
            }}
          >
            Klar
          </button>
        </div>
      </div>
    </div>
  );
}
