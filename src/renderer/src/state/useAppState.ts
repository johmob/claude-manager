import { useEffect, useState } from 'react';
import { RECONNECTED_EVENT } from '../lib/platform';
import type { AccountSnapshot, AppSettings, SessionSummary, UpdateStatus, UsageSnapshot } from '../../../shared/contracts';

export interface AppState {
  sessions: SessionSummary[];
  usage: UsageSnapshot;
  settings: AppSettings;
  account: AccountSnapshot;
  update: UpdateStatus;
}

/** Loads the initial app state and keeps it in sync with main-process pushes. Null until loaded. */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);

  useEffect(() => {
    let alive = true;
    const pushed = { sessions: false, usage: false, settings: false, account: false, update: false };
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
      window.cm.on('state:account', (account) => {
        pushed.account = true;
        buffer.account = account;
        patch({ account });
      }),
      window.cm.on('state:update', (update) => {
        pushed.update = true;
        buffer.update = update;
        patch({ update });
      }),
    ];

    // After the phone lost its connection pushes were missed: take the whole state anew.
    const refetch = (): void => {
      window.cm
        .invoke('app:get-state', undefined)
        .then((fresh) => alive && setState(fresh))
        .catch((e: unknown) => console.error('app:get-state', e));
    };
    window.addEventListener(RECONNECTED_EVENT, refetch);

    window.cm
      .invoke('app:get-state', undefined)
      .then((initial) => {
        if (!alive) return;
        setState({
          sessions: pushed.sessions && buffer.sessions ? buffer.sessions : initial.sessions,
          usage: pushed.usage && buffer.usage ? buffer.usage : initial.usage,
          settings: pushed.settings && buffer.settings ? buffer.settings : initial.settings,
          account: pushed.account && buffer.account ? buffer.account : initial.account,
          update: pushed.update && buffer.update ? buffer.update : initial.update,
        });
      })
      .catch((e: unknown) => console.error('app:get-state', e));

    return () => {
      alive = false;
      window.removeEventListener(RECONNECTED_EVENT, refetch);
      offs.forEach((off) => off());
    };
  }, []);

  return state;
}
