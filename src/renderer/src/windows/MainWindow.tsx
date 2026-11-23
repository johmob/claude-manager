import { useEffect, useState } from 'react';
import { AccountContext } from '../state/account';
import { useAppState } from '../state/useAppState';
import { TopBar, type ViewMode } from '../components/TopBar';
import { StartDialog, type DialogKind } from '../components/StartDialogs';
import { OverviewView } from '../views/OverviewView';
import { FocusView } from '../views/FocusView';

export function MainWindow() {
  const state = useAppState();
  const [view, setView] = useState<ViewMode>('overview');
  const [dialog, setDialog] = useState<DialogKind | null>(null);

  useEffect(
    () =>
      // Main has already put the session in Fokus; just show that view.
      window.cm.on('ui:open-session', () => setView('focus')),
    [],
  );

  if (!state) return <div className="loading">Laddar…</div>;
  const { sessions, usage, settings, account } = state;
  const focused = sessions.filter((s) => s.focused);

  return (
    <AccountContext.Provider value={account}>
    <div className="main-window">
      <TopBar settings={settings} view={view} onView={setView} onDialog={setDialog} />
      <main className="main-content">
        {view === 'overview' ? (
          <OverviewView sessions={sessions} usage={usage} onDialog={setDialog} />
        ) : (
          <FocusView sessions={focused} />
        )}
      </main>
      {dialog && <StartDialog kind={dialog} settings={settings} onClose={() => setDialog(null)} />}
    </div>
    </AccountContext.Provider>
  );
}
