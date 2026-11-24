import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { AskQuestionsContext, QuestionQueue, questionsKey } from '../components/QuestionFlow';
import { AccountContext } from '../state/account';
import { ChatDetailContext } from '../state/chatDetail';
import { useAppState } from '../state/useAppState';
import { useTheme } from '../lib/theme';
import { ImageViewer } from '../components/ImageViewer';
import { useTextScale } from '../lib/textScale';
import { TopBar, type ViewMode } from '../components/TopBar';
import { StartDialog, type DialogKind } from '../components/StartDialogs';
import { Welcome } from '../components/Welcome';
import { OverviewView } from '../views/OverviewView';
import { FocusView } from '../views/FocusView';

export function MainWindow() {
  const state = useAppState();
  useTheme(state?.settings.theme);
  const [view, setView] = useState<ViewMode>('overview');
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [welcomeLater, setWelcomeLater] = useState(false);
  useTextScale(state?.settings.textScale);
  /** Question sets the user put off in this window; they are not offered again on their own. */
  const putOff = useRef(new Set<string>());
  const latest = useRef<SessionSummary[]>([]);
  latest.current = state?.sessions ?? [];
  const askingNow = useRef(asking);
  askingNow.current = asking;

  /** When the app comes to the front with questions waiting, they are shown at once, full screen. */
  const offerQuestions = useCallback(() => {
    if (askingNow.current) return;
    const next = latest.current.find((s) => s.questions.length && !putOff.current.has(questionsKey(s)));
    if (next) setAsking(next.id);
  }, []);
  useEffect(() => {
    window.addEventListener('focus', offerQuestions);
    return () => window.removeEventListener('focus', offerQuestions);
  }, [offerQuestions]);
  const loaded = state !== null;
  useEffect(() => {
    if (loaded && document.hasFocus()) offerQuestions();
  }, [loaded, offerQuestions]);

  useEffect(
    () =>
      // Main has already put the session in Fokus; show that view, and its questions if it has any.
      window.cm.on('ui:open-session', ({ id }) => {
        setView('focus');
        if (latest.current.find((s) => s.id === id)?.questions.length) setAsking(id);
      }),
    [],
  );

  if (!state) return <div className="loading">Laddar…</div>;
  const { sessions, usage, settings, account, update } = state;
  const focused = sessions.filter((s) => s.focused);

  return (
    <AccountContext.Provider value={account}>
    <AskQuestionsContext.Provider value={setAsking}>
    <ChatDetailContext.Provider value={settings.chatDetail}>
    <div className="main-window">
      <TopBar settings={settings} update={update} view={view} onView={setView} onDialog={setDialog} />
      <main className="main-content">
        {view === 'overview' ? (
          <OverviewView sessions={sessions} usage={usage} onDialog={setDialog} />
        ) : (
          <FocusView sessions={focused} />
        )}
      </main>
      {dialog && <StartDialog kind={dialog} settings={settings} onClose={() => setDialog(null)} />}
      <ImageViewer />
      {!settings.projectsRoot && !welcomeLater && !dialog && <Welcome onLater={() => setWelcomeLater(true)} />}
      {asking && (
        <QuestionQueue
          sessions={sessions}
          firstId={asking}
          onClose={() => {
            // Whatever is still waiting was put off; it is not offered again on its own.
            for (const s of latest.current) if (s.questions.length) putOff.current.add(questionsKey(s));
            setAsking(null);
          }}
        />
      )}
    </div>
    </ChatDetailContext.Provider>
    </AskQuestionsContext.Provider>
    </AccountContext.Provider>
  );
}
