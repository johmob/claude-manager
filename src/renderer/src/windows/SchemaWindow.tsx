import { useEffect, useState } from 'react';
import { WorkSchema } from '../components/WorkSchema';
import { send } from '../lib/api';
import { AccountContext } from '../state/account';
import { useAppState } from '../state/useAppState';

/**
 * A session's work schema on its own, opened from the overlay (right-click) without bringing the
 * main window forward. The window covers the screen transparently, so the schema shows as a modal
 * over whatever is open; it follows the session's live state like every other window.
 */
export function SchemaWindow() {
  const state = useAppState();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const off = window.cm.on('schema:show', (req) => setId(req.id));
    // The first "show" may arrive before this listener exists, so ask once as well.
    void window.cm.invoke('schema:current', undefined).then((current) => setId((prev) => prev ?? current));
    return off;
  }, []);

  const close = (): void => {
    setId(null);
    send('schema:close', undefined);
  };
  const session = state?.sessions.find((s) => s.id === id);
  if (!state || !session) return null;
  return (
    <AccountContext.Provider value={state.account}>
      <WorkSchema session={session} onClose={close} standalone />
    </AccountContext.Provider>
  );
}
