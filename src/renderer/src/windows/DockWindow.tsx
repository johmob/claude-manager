import type { CSSProperties } from 'react';
import { StatusChip } from '../components/Atoms';
import { send } from '../lib/api';
import { useAppState } from '../state/useAppState';

export function DockWindow() {
  const state = useAppState();
  if (!state) return null;
  const vertical = state.settings.dockEdge === 'right';
  return (
    <div className={vertical ? 'dock vertical' : 'dock horizontal'}>
      {state.sessions.map((s) => (
        <button
          type="button"
          key={s.id}
          className="dock-card"
          data-status={s.status}
          style={{ '--accent': s.color } as CSSProperties}
          onClick={() => send('window:show-session', { id: s.id })}
        >
          <span className="dock-strip" />
          <span className="dock-body">
            <span className="dock-top">
              <span className="dock-name">{s.name}</span>
              <StatusChip status={s.status} />
            </span>
            <span className="dock-task">{s.currentTask || ' '}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
