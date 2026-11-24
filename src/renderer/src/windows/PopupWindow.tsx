import { useEffect, useState } from 'react';
import type { PopupView } from '../../../shared/contracts';
import { AskQuestionsContext, QuestionQueue } from '../components/QuestionFlow';
import { QuickChat } from '../components/QuickChat';
import { WorkSchema } from '../components/WorkSchema';
import { send } from '../lib/api';
import { AccountContext } from '../state/account';
import { useAppState } from '../state/useAppState';
import { useTheme } from '../lib/theme';
import { ImageViewer } from '../components/ImageViewer';
import { useTextScale } from '../lib/textScale';

/**
 * A session's work schema or its questions on their own, opened from the overlay without bringing the
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
  if (!state || !view) return null;
  if (view.kind === 'schema' && !session) return null;
  return (
    <AccountContext.Provider value={state.account}>
      <AskQuestionsContext.Provider value={(id) => setView({ kind: 'questions', id })}>
        {view.kind === 'schema' ? (
          session && <WorkSchema session={session} onClose={close} standalone />
        ) : (
          <QuestionQueue key={view.id} sessions={state.sessions} firstId={view.id} onClose={close} />
        )}
      </AskQuestionsContext.Provider>
      <ImageViewer />
    </AccountContext.Provider>
  );
}
