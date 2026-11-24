import type { OpenQuestion } from '../../../shared/contracts';

/**
 * Answers typed so far, per session and question, kept while the box is closed and while more questions
 * arrive. They live in browser storage, which the app's windows share, so answers begun in the overlay
 * show up in the chat. Without storage they last only while the box is open.
 */
const DRAFT_PREFIX = 'qf-draft:';
export type Drafts = Record<string, string>;

export const drafts = {
  get(sessionId: string): Drafts {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(DRAFT_PREFIX + sessionId) ?? '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Drafts) : {};
    } catch {
      return {};
    }
  },
  set(sessionId: string, answers: Drafts): void {
    try {
      localStorage.setItem(DRAFT_PREFIX + sessionId, JSON.stringify(answers));
    } catch {
      // Not kept; the answers still go out when sent now.
    }
  },
  delete(sessionId: string): void {
    try {
      localStorage.removeItem(DRAFT_PREFIX + sessionId);
    } catch {
      // Nothing kept to remove.
    }
  },
};

/** A question's place in the drafts: its words, so answers stay put when more questions arrive. */
export function draftKey(q: Pick<OpenQuestion, 'text'>): string {
  return q.text.trim().toLowerCase();
}

/** The one message that carries every answer back to the agent. */
export function composeAnswers(questions: OpenQuestion[], answers: string[]): string {
  const lines = ['Svar på dina frågor och antaganden:', ''];
  questions.forEach((q, i) => {
    const answer = answers[i]?.trim().replace(/\n/g, '\n   ');
    lines.push(`${i + 1}. ${q.kind === 'assumption' ? 'Antagande: ' : ''}${q.text}`);
    lines.push(`   Svar: ${answer || 'Inget svar (bestäm själv eller fråga igen senare).'}`);
  });
  return lines.join('\n');
}

/** Calls back when another window (the overlay) changed this session's drafts. Returns the unsubscribe. */
export function onDraftsChanged(sessionId: string, cb: () => void): () => void {
  const handler = (e: StorageEvent): void => {
    if (e.key === DRAFT_PREFIX + sessionId || e.key === null) cb();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
