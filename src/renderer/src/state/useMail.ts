import { useEffect, useState } from 'react';
import type { MailDraftView, MailOverview } from '../../../shared/contracts';

/**
 * The mail overview (attention list, counts, source status), kept in sync with main-process pushes.
 * Null until loaded, and while main has no mail handler (mail off or an older main).
 */
export function useMail(): MailOverview | null {
  const [overview, setOverview] = useState<MailOverview | null>(null);

  useEffect(() => {
    let alive = true;
    // A push that arrives before the first answer wins over it.
    let pushed = false;
    const off = window.cm.on('state:mail', (next) => {
      pushed = true;
      setOverview(next);
    });
    window.cm
      .invoke('mail:overview', undefined)
      .then((initial) => {
        if (alive && !pushed) setOverview(initial);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return overview;
}

/** The latest draft of a mail; refetched when main reports that it changed. Null when none, or no mail selected. */
export function useMailDraft(mailId: number | null): MailDraftView | null {
  const [draft, setDraft] = useState<MailDraftView | null>(null);

  useEffect(() => {
    setDraft(null);
    if (mailId === null) return;
    let alive = true;
    const load = (): void => {
      window.cm
        .invoke('mail:draft', { mailId })
        .then((d) => {
          if (alive) setDraft(d);
        })
        .catch(() => undefined);
    };
    load();
    const off = window.cm.on('mail:draft-changed', (e) => {
      if (e.mailId === mailId) load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [mailId]);

  return draft;
}
