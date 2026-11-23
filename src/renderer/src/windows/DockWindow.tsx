import type { CSSProperties } from 'react';
import { StatusChip } from '../components/Atoms';
import { CalloutIcon } from '../components/CalloutBox';
import { send } from '../lib/api';
import { useAppState } from '../state/useAppState';
import { useTheme } from '../lib/theme';

export function DockWindow() {
  const state = useAppState();
  useTheme(state?.settings.theme);
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
              {s.callouts[0] && s.callouts[0].kind !== 'tip' && (
                <span className="dock-callout" data-kind={s.callouts[0].kind} title={s.callouts[0].title}>
                  <CalloutIcon kind={s.callouts[0].kind} />
                </span>
              )}
              <StatusChip status={s.status} />
            </span>
            <span className="dock-task">{s.currentTask || ' '}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
