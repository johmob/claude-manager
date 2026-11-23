import { useEffect, useState } from 'react';
import type { AppSettings, SessionSummary, UsageSnapshot } from '../../../shared/contracts';

export interface AppState {
  sessions: SessionSummary[];
  usage: UsageSnapshot;
  settings: AppSettings;
}

/** Loads the initial app state and keeps it in sync with main-process pushes. Null until loaded. */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);

  useEffect(() => {
    let alive = true;
    const pushed = { sessions: false, usage: false, settings: false };
    const patch = (p: Partial<AppState>): void => setState((prev) => (prev ? { ...prev, ...p } : prev));
    // Pushes that arrive before the initial snapshot are buffered and applied on top of it.
    const buffer: Partial<AppState> = {};

    const offs = [
      window.cm.on('state:sessions', (sessions) => {
        pushed.sessions = true;
        buffer.sessions = sessions;
        patch({ sessions });
      }),
      window.cm.on('state:usage', (usage) => {
        pushed.usage = true;
        buffer.usage = usage;
        patch({ usage });
      }),
      window.cm.on('state:settings', (settings) => {
        pushed.settings = true;
        buffer.settings = settings;
        patch({ settings });
      }),
    ];

    window.cm
      .invoke('app:get-state', undefined)
      .then((initial) => {
        if (!alive) return;
        setState({
          sessions: pushed.sessions && buffer.sessions ? buffer.sessions : initial.sessions,
          usage: pushed.usage && buffer.usage ? buffer.usage : initial.usage,
          settings: pushed.settings && buffer.settings ? buffer.settings : initial.settings,
        });
      })
      .catch((e: unknown) => console.error('app:get-state', e));

    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, []);

  return state;
}
