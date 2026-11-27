import { useCallback, useEffect, useState } from 'react';
import type { MailHandled, MailMessageView } from '../../../../shared/contracts';
import { errorMessage, send } from '../../lib/api';
import { useMail, useMailDraft } from '../../state/useMail';
import '../../styles/mail-case.css';
import { Modal } from '../Modal';
import { MailChat } from './MailChat';
import { MailDraft } from './MailDraft';
import { MailMessage } from './MailMessage';
import { agentActionsDisabled } from './mailRows';

export type MailCaseMode = 'mail' | 'draft' | 'chat';

const HANDLED_TEXT: Record<MailHandled, string> = {
  dropped: 'Släppt',
  replied: 'Besvarat',
  declined: 'Du avstod från att svara',
  done: 'Klart',
  outlook: 'Läst i Outlook',
};

/** The message of one mail; refetched when main reports a change of the mail or its draft, the old one kept meanwhile. */
function useMailMessage(mailId: number): { view: MailMessageView | null; loaded: boolean; error: string } {
  const overview = useMail();
  const [view, setView] = useState<MailMessageView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setView(null);
    setLoaded(false);
  }, [mailId]);
  useEffect(() => window.cm.on('mail:draft-changed', (e) => e.mailId === mailId && setTick((t) => t + 1)), [mailId]);
  useEffect(() => {
    let alive = true;
    window.cm
      .invoke('mail:message', { mailId, html: true })
      .then((v) => {
        if (!alive) return;
        setView(v);
        setLoaded(true);
        setError('');
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setLoaded(true);
        setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [mailId, overview, tick]);

  return { view, loaded, error };
}

/**
 * One mail in full: the original on the left (in the app, never in Outlook), and next to it what the user is
 * doing with it: the draft to approve ("Svara åt mig") or a talk with the agent ("Ta det med agenten").
 */
export function MailCase({ mailId, mode: initial, onClose }: { mailId: number; mode: MailCaseMode; onClose: () => void }) {
  const { view, loaded, error } = useMailMessage(mailId);
  const draft = useMailDraft(mailId);
  const [mode, setMode] = useState<MailCaseMode>(initial);
  const [actError, setActError] = useState('');
  useEffect(() => setMode(initial), [initial, mailId]);

  const item = view?.item ?? null;
  const agentOff = !!item && agentActionsDisabled(item);

  const run = useCallback((action: 'reply' | 'agent' | 'drop' | 'done' | 'reopen'): void => {
    window.cm.invoke('mail:act', { mailId, action }).catch((e: unknown) => setActError(errorMessage(e)));
  }, [mailId]);

  const choose = (next: MailCaseMode): void => {
    setActError('');
    setMode(next);
    if (!item) return;
    if (next === 'draft' && (!draft || draft.status === 'declined')) run('reply');
    if (next === 'chat' && item.status !== 'in_chat') run('agent');
  };

  if (!view || !item) {
    return (
      <Modal title="Mejl" size="full" onClose={onClose}>
        <div className="mc mc-empty">{!loaded ? 'Hämtar mejlet…' : error || 'Mejlet finns inte längre.'}</div>
      </Modal>
    );
  }

  const handled = item.handled;
  const others = [...view.to, ...view.cc].filter((a) => a.address && a.address.toLowerCase() !== item.from.address.toLowerCase());

  return (
    <Modal title="Mejl" size="full" onClose={onClose}>
      <div className="mc" data-mode={mode}>
        <div className="mc-bar">
          <div className="mc-tabs" role="tablist" aria-label="Vad vill du göra med mejlet?">
            <button type="button" role="tab" aria-selected={mode === 'mail'} data-on={mode === 'mail' || undefined} onClick={() => choose('mail')}>Bara mejlet</button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'draft'}
              data-on={mode === 'draft' || undefined}
              disabled={agentOff}
              title={agentOff ? 'Mejlet är undantaget från Claude av en av dina regler' : 'Agenten skriver ett svar som du godkänner'}
              onClick={() => choose('draft')}
            >
              Svara åt mig
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'chat'}
              data-on={mode === 'chat' || undefined}
              disabled={agentOff}
              title={agentOff ? 'Mejlet är undantaget från Claude av en av dina regler' : 'Prata igenom mejlet med agenten'}
              onClick={() => choose('chat')}
            >
              Ta det med agenten
            </button>
          </div>
          <div className="mc-bar-right">
            {handled ? (
              <>
                <span className="mc-handled">{HANDLED_TEXT[handled]}</span>
                <button type="button" className="btn small" title="Ta upp mejlet igen (det blir inte oläst i Outlook)" onClick={() => run('reopen')}>Öppna igen</button>
              </>
            ) : (
              <button
                type="button"
                className="btn small"
                title="Ignorera mejlet: det markeras som läst i Outlook"
                onClick={() => {
                  send('mail:act', { mailId, action: 'drop' });
                  onClose();
                }}
              >
                Släpp
              </button>
            )}
          </div>
        </div>
        {actError && <div className="mm-error" role="alert">{actError}</div>}
        <div className="mc-split">
          <section className="mc-mail" aria-label="Originalmejlet">
            <MailMessage view={view} />
          </section>
          {mode === 'draft' && (
            <section className="mc-side" aria-label="Svarsutkast">
              <MailDraft mailId={mailId} draft={draft} writing={item.draft === 'writing' || item.status === 'drafting'} from={item.from} others={others} onFinished={onClose} />
            </section>
          )}
          {mode === 'chat' && (
            <section className="mc-side" aria-label="Chatt med agenten">
              <MailChat item={item} sessionId={view.sessionId} draft={draft} from={item.from} others={others} onClose={onClose} />
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
