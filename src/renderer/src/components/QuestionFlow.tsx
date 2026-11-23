import { createContext, useContext, useEffect, useState, type CSSProperties } from 'react';
import type { OpenQuestion, SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';
import { MarkdownText } from './MarkdownText';
import { Modal } from './Modal';

/** Opens the question flow for a session; provided by the window that shows it. */
export const AskQuestionsContext = createContext<(sessionId: string) => void>(() => undefined);

/** Identifies one set of questions: a new turn that leaves questions gives a new key. */
export function questionsKey(session: SessionSummary): string {
  return `${session.id}:${session.questionsId}`;
}

/**
 * Answers typed so far, per set of questions, kept while the flow is closed. They live in browser
 * storage, which the app's windows share, so answers begun in the app continue from the overlay. Without
 * storage they last only while the flow is open.
 */
const DRAFT_PREFIX = 'qf-draft:';
const drafts = {
  get(key: string): string[] | null {
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + key);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      return null;
    }
  },
  set(key: string, answers: string[]): void {
    try {
      localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(answers));
    } catch {
      // Not kept; the answers still go out when sent now.
    }
  },
  delete(key: string): void {
    try {
      localStorage.removeItem(DRAFT_PREFIX + key);
    } catch {
      // Nothing kept to remove.
    }
  },
};

const KIND_LABEL: Record<OpenQuestion['kind'], string> = { question: 'Fråga', assumption: 'Antagande – stämmer det?' };

/** The one message that carries every answer back to the agent. */
function composeAnswers(questions: OpenQuestion[], answers: string[]): string {
  const lines = ['Svar på dina frågor och antaganden:', ''];
  questions.forEach((q, i) => {
    const answer = answers[i]?.trim().replace(/\n/g, '\n   ');
    lines.push(`${i + 1}. ${q.kind === 'assumption' ? 'Antagande: ' : ''}${q.text}`);
    lines.push(`   Svar: ${answer || 'Inget svar (bestäm själv eller fråga igen senare).'}`);
  });
  return lines.join('\n');
}

/**
 * The questions and assumptions a turn ended with, one at a time in large text, each with its own
 * answer box. At the end everything is reviewed and sent back to the agent as one message.
 */
export function QuestionFlow({ session, onClose, onSent }: { session: SessionSummary; onClose: () => void; onSent: () => void }) {
  const { questions } = session;
  const key = questionsKey(session);
  const [saved] = useState(() => drafts.get(key));
  const [answers, setAnswers] = useState<string[]>(() => questions.map((_, i) => saved?.[i] ?? ''));
  const firstOpen = answers.findIndex((a) => !a.trim());
  const [index, setIndex] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [review, setReview] = useState(firstOpen === -1 && saved !== null);
  useEffect(() => void drafts.set(key, answers), [key, answers]);

  const last = questions.length - 1;
  const q = questions[index];
  const answered = answers.filter((a) => a.trim()).length;
  const setAnswer = (text: string): void => setAnswers((prev) => prev.map((a, i) => (i === index ? text : a)));
  const go = (i: number): void => {
    setReview(false);
    setIndex(i);
  };
  const next = (): void => (index < last ? go(index + 1) : setReview(true));
  const submit = (): void => {
    send('session:send', { id: session.id, text: composeAnswers(questions, answers) });
    drafts.delete(key);
    onSent();
  };

  return (
    <Modal title={`${session.name} – ${questions.length} ${questions.length === 1 ? 'fråga' : 'frågor'} till dig`} onClose={onClose} size="full">
      <div className="qf" style={{ '--accent': session.color } as CSSProperties}>
        <div className="qf-steps">
          {questions.map((item, i) => (
            <button
              key={i}
              type="button"
              className="qf-step-dot"
              data-kind={item.kind}
              data-current={!review && i === index ? 'true' : undefined}
              data-answered={answers[i]?.trim() ? 'true' : undefined}
              title={item.text}
              onClick={() => go(i)}
            >
              {i + 1}
            </button>
          ))}
          <button type="button" className="qf-step-dot qf-step-review" data-current={review ? 'true' : undefined} onClick={() => setReview(true)}>
            Skicka
          </button>
        </div>

        {review ? (
          <div className="qf-review">
            <div className="qf-review-head">{answered} av {questions.length} besvarade. Allt skickas till agenten som ett meddelande.</div>
            <ol className="qf-review-list">
              {questions.map((item, i) => (
                <li key={i} onClick={() => go(i)} title="Klicka för att ändra">
                  <div className="qf-review-q">
                    {item.kind === 'assumption' && <span className="qf-tag">Antagande</span>}
                    {item.text}
                  </div>
                  <div className={answers[i]?.trim() ? 'qf-review-a' : 'qf-review-a qf-empty'}>{answers[i]?.trim() || 'Inget svar'}</div>
                </li>
              ))}
            </ol>
            <div className="qf-actions">
              <button type="button" className="btn" onClick={() => go(last)}>‹ Tillbaka</button>
              <button type="button" className="btn primary qf-send" onClick={submit}>Skicka alla svar</button>
            </div>
          </div>
        ) : (
          q && (
            <div className="qf-card" data-kind={q.kind}>
              <div className="qf-kind">
                {KIND_LABEL[q.kind]}
                <span className="qf-count">{index + 1} av {questions.length}</span>
              </div>
              {q.context && <div className="qf-context">{q.context}</div>}
              <div className="qf-question">{q.text}</div>
              {q.detail && (
                <div className="qf-detail">
                  <MarkdownText text={q.detail} />
                </div>
              )}
              {session.questionsAnswer.trim().length > q.detail.length + 40 && (
                <details className="qf-full">
                  <summary>Visa hela svaret från agenten</summary>
                  <div className="qf-detail">
                    <MarkdownText text={session.questionsAnswer} />
                  </div>
                </details>
              )}
              <textarea
                key={index}
                className="input qf-answer"
                rows={4}
                autoFocus
                value={answers[index] ?? ''}
                placeholder={q.kind === 'assumption' ? 'Rätta här om det är fel… (Enter: nästa, Skift+Enter: ny rad)' : 'Ditt svar… (Enter: nästa, Skift+Enter: ny rad)'}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    next();
                  }
                }}
              />
              <div className="qf-actions">
                <button type="button" className="btn" disabled={index === 0} onClick={() => go(index - 1)}>‹ Föregående</button>
                <span className="qf-spacer" />
                {q.kind === 'assumption' && (
                  <button
                    type="button"
                    className="btn qf-ok"
                    onClick={() => {
                      setAnswer('Stämmer.');
                      next();
                    }}
                  >
                    Stämmer
                  </button>
                )}
                <button type="button" className="btn" onClick={next}>Hoppa över</button>
                <button type="button" className="btn primary" onClick={next}>{index < last ? 'Nästa ›' : 'Granska och skicka ›'}</button>
              </div>
            </div>
          )
        )}
      </div>
    </Modal>
  );
}

/** Prominent "Svara på 8 frågor" on a card or tile; opens the question flow. */
export function QuestionsButton({ session }: { session: SessionSummary }) {
  const ask = useContext(AskQuestionsContext);
  const count = session.questions.length;
  if (!count) return null;
  const assumptions = session.questions.filter((q) => q.kind === 'assumption').length;
  return (
    <button
      type="button"
      className="questions-btn"
      title={session.questions.map((q) => q.text).join('\n')}
      onClick={(e) => {
        e.stopPropagation();
        ask(session.id);
      }}
    >
      <span className="questions-btn-icon">?</span>
      <span className="questions-btn-text">
        <strong>Svara på {count} {count === 1 ? 'fråga' : 'frågor'}</strong>
        {assumptions > 0 && <span> · varav {assumptions} {assumptions === 1 ? 'antagande' : 'antaganden'}</span>}
      </span>
      <span className="questions-btn-go">›</span>
    </button>
  );
}
