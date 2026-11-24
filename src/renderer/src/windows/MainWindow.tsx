import { useEffect, useRef, useState } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { AskQuestionsContext } from '../components/QuestionBox';
import { send } from '../lib/api';
import { requestReveal } from '../lib/revealQuestions';
import { AccountContext } from '../state/account';
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
  const [welcomeLater, setWelcomeLater] = useState(false);
  useTextScale(state?.settings.textScale);
  const latest = useRef<SessionSummary[]>([]);
  latest.current = state?.sessions ?? [];

  useEffect(
    () =>
      // Main has already put the session in Fokus; show that view, and scroll to its questions if it has any.
      window.cm.on('ui:open-session', ({ id }) => {
        setView('focus');
        if (latest.current.find((s) => s.id === id)?.questions.length) requestReveal(id);
      }),
    [],
  );

  if (!state) return <div className="loading">Laddar…</div>;
  const { sessions, usage, settings, account, update } = state;
  const focused = sessions.filter((s) => s.focused);

  return (
    <AccountContext.Provider value={account}>
    <AskQuestionsContext.Provider value={(id) => send('window:show-session', { id })}>
    <div className="main-window">
      <TopBar settings={settings} update={update} view={view} onView={setView} onDialog={setDialog} />
      <main className="main-content">
        {view === 'overview' ? (
          <OverviewView sessions={sessions} usage={usage} onDialog={setDialog} />
        ) : (
          <FocusView sessions={focused} all={sessions} />
        )}
      </main>
      {dialog && <StartDialog kind={dialog} settings={settings} onClose={() => setDialog(null)} />}
      <ImageViewer />
      {!settings.projectsRoot && !welcomeLater && !dialog && <Welcome onLater={() => setWelcomeLater(true)} />}
    </div>
    </AskQuestionsContext.Provider>
    </AccountContext.Provider>
  );
}
