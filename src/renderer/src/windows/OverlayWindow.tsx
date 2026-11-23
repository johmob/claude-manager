import { useRef, type CSSProperties, type MouseEvent } from 'react';
import { monogram } from '../lib/format';
import { send } from '../lib/api';
import { useAppState } from '../state/useAppState';

const MAX_NAME = 7;

function shortName(name: string): string {
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}

/** Click-through strip of tiny session icons; interactive only while Ctrl is held. */
export function OverlayWindow() {
  const state = useAppState();
  const interactive = useRef(false);

  const setInteractive = (value: boolean): void => {
    if (interactive.current === value) return;
    interactive.current = value;
    send('overlay:set-interactive', { interactive: value });
  };

  if (!state) return null;
  return (
    <div
      className="overlay"
      onMouseMove={(e: MouseEvent) => setInteractive(e.ctrlKey)}
      onMouseLeave={() => setInteractive(false)}
    >
      {state.sessions.map((s) => (
        <div
          key={s.id}
          className="ov-cell"
          data-status={s.status}
          title={s.name}
          style={{ '--accent': s.color } as CSSProperties}
          onClick={() => send('window:show-session', { id: s.id })}
        >
          <span className="ov-icon">
            <span className="ov-ring" />
            <span className="ov-letters">{monogram(s.name)}</span>
            {s.status === 'error' && <span className="ov-error" />}
          </span>
          <span className="ov-name">{shortName(s.name)}</span>
        </div>
      ))}
    </div>
  );
}
