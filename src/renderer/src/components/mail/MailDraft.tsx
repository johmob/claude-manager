import { useEffect, useRef, useState } from 'react';
import type { MailAddress, MailDraftView } from '../../../../shared/contracts';
import { errorMessage, send } from '../../lib/api';
import '../../styles/mail-case.css';
import { Spinner } from '../Atoms';

interface MailDraftProps {
  mailId: number;
  draft: MailDraftView | null;
  /** The mail agent is writing (or about to), also before a draft row exists. */
  writing: boolean;
  /** Who the reply goes to, for the approval: the sender, and with "Svara alla" everyone else too. */
  from: MailAddress;
  others: MailAddress[];
  /** Smaller, for the chat view. */
  compact?: boolean;
  /** Called a moment after a send or when the user lets the draft go. */
  onFinished: () => void;
}

const SENT_SHOWN_MS = 1200;

function name(a: MailAddress): string {
  return a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address;
}

/**
 * The agent's draft, to be approved: editable text, "Svara alla", proposed attachments (never pre-ticked),
 * and the three choices Skicka, Ändra med kommentar and Avstå. Nothing leaves the computer until Skicka.
 */
export function MailDraft({ mailId, draft, writing, from, others, compact = false, onFinished }: MailDraftProps) {
  const [body, setBody] = useState('');
  const [replyAll, setReplyAll] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'send' | 'revise' | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const finish = useRef(onFinished);
  finish.current = onFinished;

  // A new draft or a new version replaces what is in the box; nothing the user typed survives a rewrite on purpose.
  // The status is part of the key: a draft keeps its id and version when it goes from writing to proposed.
  const key = draft ? `${draft.id}:${draft.version}:${draft.status}` : '';
  useEffect(() => {
    if (!draft) return;
    setBody(draft.body);
    setReplyAll(draft.replyAll);
    setTicked(new Set());
    setCommenting(false);
    setComment('');
    setBusy(null);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const status = draft?.status;
  const proposed = status === 'proposed';
  const edited = !!draft && body.trim() !== draft.body.trim();

  const doSend = (): void => {
    if (!draft || !proposed || busy || !body.trim()) return;
    setBusy('send');
    setError('');
    window.cm
      .invoke('mail:draft-send', { mailId, draftId: draft.id, body, replyAll, attachments: draft.attachments.filter((a) => ticked.has(a.path)).map((a) => a.path) })
      .then((r) => {
        if (r.ok) {
          setSent(true);
          setTimeout(() => finish.current(), SENT_SHOWN_MS);
        } else setError(r.error || 'Det gick inte att skicka.');
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null));
  };

  const doRevise = (): void => {
    const text = comment.trim();
    if (!text || busy) return;
    setBusy('revise');
    setError('');
    window.cm
      .invoke('mail:draft-revise', { mailId, comment: text })
      .then(() => {
        setCommenting(false);
        setComment('');
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null));
  };

  const decline = (): void => {
    if (draft && proposed) window.cm.invoke('mail:draft-decline', { mailId, draftId: draft.id }).catch((e: unknown) => console.error(e));
    finish.current();
  };

  if (sent || status === 'sent') {
    return <div className="mdr mdr-state" data-compact={compact || undefined}><span className="mdr-ok">Skickat</span></div>;
  }

  if (!draft || status === 'writing' || status === 'superseded') {
    if (writing || draft) {
      return (
        <div className="mdr mdr-state" data-compact={compact || undefined}>
          <Spinner /> <span>Skriver svar…</span>
        </div>
      );
    }
    return (
      <div className="mdr mdr-state" data-compact={compact || undefined}>
        <span className="mdr-muted">Inget utkast ännu.</span>
        <button type="button" className="btn primary" onClick={() => send('mail:act', { mailId, action: 'reply' })}>Svara åt mig</button>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="mdr mdr-state" data-compact={compact || undefined}>
        <span className="mm-error">{draft.error || 'Utkastet kunde inte skrivas.'}</span>
        <button type="button" className="btn primary" onClick={() => send('mail:act', { mailId, action: 'reply' })}>Försök igen</button>
      </div>
    );
  }

  if (status === 'declined') {
    return (
      <div className="mdr mdr-state" data-compact={compact || undefined}>
        <span className="mdr-muted">Du avstod från det här utkastet.</span>
        <button type="button" className="btn" onClick={() => send('mail:act', { mailId, action: 'reply' })}>Skriv ett nytt svar</button>
      </div>
    );
  }

  const recipients = replyAll ? [from, ...others] : [from];
  return (
    <div className="mdr" data-compact={compact || undefined}>
      <div className="mdr-to" title={recipients.map(name).join('\n')}>
        <span className="mdr-to-label">Till</span> {recipients.map((a) => a.name || a.address).join(', ')}
      </div>
      <textarea
        className="input mdr-text"
        value={body}
        spellCheck
        aria-label="Svarsutkast"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            doSend();
          }
        }}
      />
      <div className="mdr-opts">
        <label className="mdr-check" title="Skicka svaret till alla som fick mejlet, inte bara avsändaren">
          <input type="checkbox" checked={replyAll} onChange={(e) => setReplyAll(e.target.checked)} /> Svara alla
        </label>
        {edited && <span className="mdr-edited">Ändrat av dig</span>}
      </div>
      {draft.attachments.length > 0 && (
        <div className="mdr-atts">
          <div className="mdr-atts-title">Bilagor agenten föreslår (bocka i dem som ska med)</div>
          {draft.attachments.map((a) => (
            <label key={a.path} className="mdr-check" title={a.path}>
              <input
                type="checkbox"
                checked={ticked.has(a.path)}
                onChange={(e) => setTicked((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(a.path);
                  else next.delete(a.path);
                  return next;
                })}
              />
              {' '}{a.name} <span className="mdr-path">{a.path}</span>
            </label>
          ))}
        </div>
      )}
      {commenting && (
        <div className="mdr-comment">
          <textarea
            className="input"
            autoFocus
            rows={3}
            placeholder="Vad ska ändras? Till exempel: kortare, mer formellt, nämn torsdag."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                doRevise();
              }
            }}
          />
          <div className="mdr-row">
            <button type="button" className="btn primary" disabled={!comment.trim() || busy !== null} onClick={doRevise}>Skriv om (Ctrl+Retur)</button>
            <button type="button" className="btn" onClick={() => setCommenting(false)}>Avbryt</button>
          </div>
        </div>
      )}
      {error && <div className="mm-error" role="alert">{error}</div>}
      <div className="mdr-row mdr-actions">
        <button type="button" className="btn primary" disabled={!body.trim() || busy !== null} title="Skicka svaret via Outlook (Ctrl+Retur)" onClick={doSend}>
          {busy === 'send' ? 'Skickar…' : 'Skicka'}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => setCommenting(true)}>Ändra med kommentar</button>
        <button type="button" className="btn" disabled={busy === 'send'} title="Skicka inget; utkastet läggs undan" onClick={decline}>Avstå</button>
      </div>
    </div>
  );
}
