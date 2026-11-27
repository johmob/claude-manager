import { useEffect, useState } from 'react';
import type { PopupView } from '../../../shared/contracts';
import { MailCase } from '../components/mail/MailCase';
import { MailList } from '../components/mail/MailList';
import { Modal } from '../components/Modal';
import { QuickChat } from '../components/QuickChat';
import { WorkSchema } from '../components/WorkSchema';
import { send } from '../lib/api';
import { AccountContext } from '../state/account';
import { useAppState } from '../state/useAppState';
import { useTheme } from '../lib/theme';
import { ImageViewer } from '../components/ImageViewer';
import { useTextScale } from '../lib/textScale';

/**
 * A session's work schema, the quick chat or a mail (the case or the list) on their own, opened from the overlay without bringing the
 * main window forward. The window covers the screen transparently, so they show as a modal over
 * whatever is open; it follows the session's live state like every other window.
 */
export function PopupWindow() {
  const state = useAppState();
  useTheme(state?.settings.theme);
  const [view, setView] = useState<PopupView | null>(null);
  // A mail opened from the list goes back to the list when closed (Esc once more closes the window).
  const [fromList, setFromList] = useState(false);
  useTextScale(state?.settings.textScale);
  useEffect(() => {
    const off = window.cm.on('popup:show', (next) => {
      setFromList(false);
      setView(next);
    });
    // The first "show" may arrive before this listener exists, so ask once as well.
    void window.cm.invoke('popup:current', undefined).then((current) => setView((prev) => prev ?? current));
    return off;
  }, []);

  const close = (): void => {
    setFromList(false);
    setView(null);
    send('popup:close', undefined);
  };
  const session = state?.sessions.find((s) => s.id === view?.id);

  if (state && view?.kind === 'quick') return (
    <>
      <QuickChat onClose={close} large />
      <ImageViewer />
    </>
  );
  if (state && view?.kind === 'mail') {
    const mailId = Number(view.id);
    return (
      <>
        {view.mode === 'list' || !Number.isFinite(mailId) ? (
          <Modal title="Mejl" size="full" onClose={close}>
            <MailList
              onOpen={(id, mode) => {
                setFromList(true);
                setView({ kind: 'mail', id: String(id), mode });
              }}
            />
          </Modal>
        ) : (
          <MailCase
            mailId={mailId}
            mode={view.mode ?? 'mail'}
            onClose={fromList ? () => { setFromList(false); setView({ kind: 'mail', id: 'list', mode: 'list' }); } : close}
          />
        )}
        <ImageViewer />
      </>
    );
  }
  if (!state || !view || view.kind !== 'schema' || !session) return null;
  return (
    <AccountContext.Provider value={state.account}>
      <WorkSchema session={session} onClose={close} standalone />
      <ImageViewer />
    </AccountContext.Provider>
  );
}
