import { createContext, useContext, useEffect, useState, type CSSProperties } from 'react';
import type { OpenQuestion, SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';
import { quickAnswers } from '../lib/quickAnswers';
import { MarkdownText } from './MarkdownText';
import { SessionMark } from './SessionMark';
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
 * answer box. After the last one everything goes back to the agent as one message, without a review step.
 */
export function QuestionFlow({ session, onClose, onSent }: { session: SessionSummary; onClose: () => void; onSent: () => void }) {
  const { questions } = session;
  const key = questionsKey(session);
  const [saved] = useState(() => drafts.get(key));
  const [answers, setAnswers] = useState<string[]>(() => questions.map((_, i) => saved?.[i] ?? ''));
  const firstOpen = answers.findIndex((a) => !a.trim());
  const [index, setIndex] = useState(firstOpen === -1 ? 0 : firstOpen);
  useEffect(() => void drafts.set(key, answers), [key, answers]);

  const last = questions.length - 1;
  const q = questions[index];
  const setAnswer = (text: string): void => setAnswers((prev) => prev.map((a, i) => (i === index ? text : a)));
  const go = (i: number): void => setIndex(i);
  const single = questions.length === 1;
  const submit = (current: string[] = answers): void => {
    send('session:send', { id: session.id, text: composeAnswers(questions, current) });
    drafts.delete(key);
    onSent();
  };
  /** On to the next question; after the last one, everything is sent. */
  const next = (current: string[] = answers): void => {
    if (index < last) go(index + 1);
    else submit(current);
  };
  /** A one-click answer: set it and move on (or send, when it was the only question). */
  const answerWith = (text: string): void => {
    const updated = answers.map((a, i) => (i === index ? text : a));
    setAnswers(updated);
    next(updated);
  };
  const confirm = (): void => answerWith('Stämmer.');
  const quick = q && q.kind === 'question' ? (q.options.length ? q.options : quickAnswers(q.text)) : [];

  return (
    <Modal title={`${session.name} – ${questions.length} ${questions.length === 1 ? 'fråga' : 'frågor'} till dig`} onClose={onClose} size="full">
      <div className="qf" style={{ '--accent': session.color } as CSSProperties}>
        <div className="qf-steps" hidden={single}>
          {questions.map((item, i) => (
            <button
              key={i}
              type="button"
              className="qf-step-dot"
              data-kind={item.kind}
              data-current={i === index ? 'true' : undefined}
              data-answered={answers[i]?.trim() ? 'true' : undefined}
              title={item.text}
              onClick={() => go(i)}
            >
              {i + 1}
            </button>
          ))}
          <button type="button" className="qf-step-dot qf-step-review" title="Skicka svaren nu" onClick={() => submit()}>
            Skicka
          </button>
        </div>

        {(
          q && (
            <div className="qf-card" data-kind={q.kind}>
              <div className="qf-kind">
                {KIND_LABEL[q.kind]}
                <span className="qf-count">{index + 1} av {questions.length}</span>
              </div>
              <QuestionSource session={session} about={q.about} />
              {q.brief && <div className="qf-brief">{q.brief}</div>}
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
              {quick.length > 0 && (
                <div className="qf-quick">
                  {quick.map((option) => (
                    <button key={option} type="button" className="btn qf-quick-btn" data-picked={answers[index] === option ? 'true' : undefined} onClick={() => answerWith(option)}>
                      {option}
                    </button>
                  ))}
                  <span className="muted">eller skriv ett eget svar nedan</span>
                </div>
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
                      confirm();
                    }}
                  >
                    Stämmer
                  </button>
                )}
                <button type="button" className="btn" onClick={() => next()}>Hoppa över</button>
                <button type="button" className="btn primary" onClick={() => next()}>{index < last ? 'Nästa ›' : 'Skicka'}</button>
              </div>
            </div>
          )
        )}
      </div>
    </Modal>
  );
}

/**
 * Which chat asks and what about: the session's name in its colour, then the part or work step the
 * question concerns (from the turn's tags), or else what the session is working on.
 */
function QuestionSource({ session, about }: { session: SessionSummary; about: string }) {
  const where = about || session.currentTask;
  return (
    <div className="q-source" style={{ '--c': session.color } as CSSProperties}>
      <span className="q-source-name"><SessionMark name={session.name} icon={session.icon} size={15} className="q-source-mark" />{session.name}</span>
      {where && <span className="q-source-about">{where}</span>}
    </div>
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

/**
 * The next unanswered question with one-click answers, for the overlay: just the question and its
 * buttons. Each click answers it (shared with the full flow); the last one sends all answers in one
 * message. Questions that need written answers, and "read more", open the full flow.
 */
export function QuickQuestion({ session, onOpen }: { session: SessionSummary; onOpen: () => void }) {
  const { questions } = session;
  const key = questionsKey(session);
  const [answers, setAnswers] = useState<string[]>(() => questions.map((_, i) => drafts.get(key)?.[i] ?? ''));
  const index = answers.findIndex((a) => !a.trim());
  const q = index === -1 ? undefined : questions[index];
  if (!q) return null;
  const options = q.kind === 'assumption' ? ['Stämmer'] : q.options.length ? q.options : quickAnswers(q.text);
  const choose = (text: string): void => {
    const updated = answers.map((a, i) => (i === index ? text : a));
    if (updated.every((a) => a.trim())) {
      send('session:send', { id: session.id, text: composeAnswers(questions, updated) });
      drafts.delete(key);
    } else {
      drafts.set(key, updated);
    }
    setAnswers(updated);
  };
  return (
    <div className="ov-q">
      <div className="ov-q-head">
        <span>{q.kind === 'assumption' ? 'Antagande' : 'Fråga'}{questions.length > 1 ? ` ${index + 1} av ${questions.length}` : ''}</span>
      </div>
      <QuestionSource session={session} about={q.about} />
      {q.brief && <div className="ov-q-brief">{q.brief}</div>}
      <div className="ov-q-text">{q.text}</div>
      <div className="ov-q-actions">
        {options.map((option) => (
          <button key={option} type="button" className="btn qf-quick-btn" onClick={() => choose(option === 'Stämmer' ? 'Stämmer.' : option)}>
            {option}
          </button>
        ))}
        <button type="button" className="link-btn" onClick={onOpen}>{options.length ? 'Läs mer' : 'Svara…'}</button>
      </div>
    </div>
  );
}
