import { useEffect, useState } from 'react';
import type { PopupView } from '../../../shared/contracts';
import { QuickChat } from '../components/QuickChat';
import { WorkSchema } from '../components/WorkSchema';
import { send } from '../lib/api';
import { AccountContext } from '../state/account';
import { useAppState } from '../state/useAppState';
import { useTheme } from '../lib/theme';
import { ImageViewer } from '../components/ImageViewer';
import { useTextScale } from '../lib/textScale';

/**
 * A session's work schema or the quick chat on their own, opened from the overlay without bringing the
 * main window forward. The window covers the screen transparently, so they show as a modal over
 * whatever is open; it follows the session's live state like every other window.
 */
export function PopupWindow() {
  const state = useAppState();
  useTheme(state?.settings.theme);
  const [view, setView] = useState<PopupView | null>(null);
  useTextScale(state?.settings.textScale);
  useEffect(() => {
    const off = window.cm.on('popup:show', (next) => setView(next));
    // The first "show" may arrive before this listener exists, so ask once as well.
    void window.cm.invoke('popup:current', undefined).then((current) => setView((prev) => prev ?? current));
    return off;
  }, []);

  const close = (): void => {
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
  if (!state || !view || view.kind !== 'schema' || !session) return null;
  return (
    <AccountContext.Provider value={state.account}>
      <WorkSchema session={session} onClose={close} standalone />
      <ImageViewer />
    </AccountContext.Provider>
  );
}
