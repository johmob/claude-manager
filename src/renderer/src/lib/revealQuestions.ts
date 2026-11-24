import { useEffect, type RefObject } from 'react';

const EVENT = 'cm-reveal-questions';
/** Sessions asked to show their questions whose box has not consumed the request yet. */
const pending = new Set<string>();

/** Asks the chat of this session to scroll to its question box. Works even if the chat mounts later. */
export function requestReveal(sessionId: string): void {
  pending.add(sessionId);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: sessionId }));
}

/** In the box: calls onReveal when a reveal was requested, now (it mounted late) or later. */
export function useReveal(sessionId: string, ref: RefObject<HTMLElement | null>, onReveal: () => void): void {
  useEffect(() => {
    const run = (): void => {
      if (!pending.has(sessionId) || !ref.current) return;
      pending.delete(sessionId);
      onReveal();
    };
    run();
    const on = (e: Event): void => {
      if ((e as CustomEvent<string>).detail === sessionId) run();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  });
}
