import { createContext, useEffect, useState } from 'react';
import { CHAT_DETAILS, type ChatDetail } from '../../../shared/contracts';

/** How much of the agents' text a chat shows (its Minimal / Moderat / Detaljerat switch). */
export const ChatDetailContext = createContext<ChatDetail>('moderate');

const KEY = 'chat-detail:';
const CHANGED = 'cm:chat-detail';

function read(sessionId: string): ChatDetail {
  try {
    const saved = localStorage.getItem(KEY + sessionId);
    return CHAT_DETAILS.find((d) => d === saved) ?? 'moderate';
  } catch {
    return 'moderate';
  }
}

/**
 * Each chat's own detail level, remembered in browser storage (shared by the app's windows), so the chat
 * window and its card follow the same choice. Moderat until chosen.
 */
export function useChatDetail(sessionId: string): [ChatDetail, (detail: ChatDetail) => void] {
  const [detail, setDetail] = useState<ChatDetail>(() => read(sessionId));
  useEffect(() => {
    const sync = (): void => setDetail(read(sessionId));
    sync();
    window.addEventListener(CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, [sessionId]);
  const choose = (next: ChatDetail): void => {
    try {
      localStorage.setItem(KEY + sessionId, next);
    } catch {
      // Not kept; the choice holds until the window reloads.
    }
    setDetail(next);
    window.dispatchEvent(new Event(CHANGED));
  };
  return [detail, choose];
}
