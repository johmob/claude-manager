import { useEffect, useState } from 'react';
import { useAppState } from '../state/useAppState';
import { useSelection } from '../state/useSelection';
import { TopBar, type ViewMode } from '../components/TopBar';
import { StartDialog, type DialogKind } from '../components/StartDialogs';
import { OverviewView } from '../views/OverviewView';
import { FocusView } from '../views/FocusView';

export function MainWindow() {
  const state = useAppState();
  const selection = useSelection();
  const [view, setView] = useState<ViewMode>('overview');
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const { select } = selection;

  useEffect(
    () =>
      window.cm.on('ui:open-session', ({ id }) => {
        select(id);
        setView('focus');
      }),
    [select],
  );

  if (!state) return <div className="loading">Laddar…</div>;
  const { sessions, usage, settings } = state;
  const focused = selection.selected.flatMap((id) => sessions.filter((s) => s.id === id));

  return (
    <div className="main-window">
      <TopBar settings={settings} view={view} onView={setView} onDialog={setDialog} />
      <main className="main-content">
        {view === 'overview' ? (
          <OverviewView sessions={sessions} usage={usage} selection={selection} onDialog={setDialog} />
        ) : (
          <FocusView sessions={focused} />
        )}
      </main>
      {dialog && <StartDialog kind={dialog} settings={settings} onClose={() => setDialog(null)} />}
    </div>
  );
}
