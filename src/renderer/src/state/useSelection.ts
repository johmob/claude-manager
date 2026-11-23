import { useCallback, useState } from 'react';

export const MAX_FOCUS = 6;
const KEY = 'cm.focusSelection';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: selection just won't persist */
  }
}

export interface Selection {
  selected: string[];
  toggle: (id: string) => void;
  /** Ensure the id is selected (dropping the oldest when full). */
  select: (id: string) => void;
}

/** Sessions chosen for focus mode (max 6), persisted in localStorage. */
export function useSelection(): Selection {
  const [selected, setSelected] = useState<string[]>(read);

  const update = useCallback((fn: (prev: string[]) => string[]) => {
    setSelected((prev) => {
      const next = fn(prev);
      write(next);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (id: string) =>
      update((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        return prev.length >= MAX_FOCUS ? prev : [...prev, id];
      }),
    [update],
  );

  const select = useCallback(
    (id: string) => update((prev) => (prev.includes(id) ? prev : [...prev, id].slice(-MAX_FOCUS))),
    [update],
  );

  return { selected, toggle, select };
}
