import { createContext } from 'react';
import type { ChatDetail } from '../../../shared/contracts';

/** How much of the agents' text the chat shows (the top bar's Minimal / Moderat / Detaljerat). */
export const ChatDetailContext = createContext<ChatDetail>('moderate');
