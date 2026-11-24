import { createContext, useContext, useEffect, useState, type CSSProperties } from 'react';
import type { OpenQuestion, SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';
import { quickAnswers } from '../lib/quickAnswers';
import { MarkdownText } from './MarkdownText';
import { SessionMark } from './SessionMark';
import { Modal } from './Modal';

/** Opens the question flow for a session; provided by the window that shows it. */
export const AskQuestionsContext = createContext<(sessionId: string) => void>(() => undefined);

/** Identifies one set of questions: a turn that leaves new questions gives a new key. */
export function questionsKey(session: SessionSummary): string {
  return `${session.id}:${session.questionsId}`;
}

/**
 * Answers typed so far, per session and question, kept while the flow is closed and while more questions
 * queue up. They live in browser storage, which the app's windows share, so answers begun in the app
 * continue from the overlay. Without storage they last only while the flow is open.
 */
const DRAFT_PREFIX = 'qf-draft:';
type Drafts = Record<string, string>;
const drafts = {
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

/** A question's place in the drafts: its words, so answers stay put when more questions queue up. */
function draftKey(q: OpenQuestion): string {
  return q.text.trim().toLowerCase();
}

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
 * Every chat's questions in one sitting: all of one chat's questions in a row (new ones from it join the
 * end while you answer), then the next chat's, shown in that chat's colour and icon. Closes when none are
 * left, or when the user closes it.
 */
export function QuestionQueue({ sessions, firstId, onClose }: { sessions: SessionSummary[]; firstId: string; onClose: () => void }) {
  const [currentId, setCurrentId] = useState(firstId);
  // Asked to show a particular chat (its card or icon was clicked): that one comes next.
  useEffect(() => setCurrentId(firstId), [firstId]);
  // Sets already sent: their questions linger until main reports the new message, and must not show again.
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const waiting = sessions.filter((s) => s.questions.length > 0 && !sent.has(questionsKey(s)));
  const current = waiting.find((s) => s.id === currentId) ?? waiting[0];
  useEffect(() => {
    if (!current) onClose();
    else if (current.id !== currentId) setCurrentId(current.id);
  }, [current?.id]);
  if (!current) return null;
  return (
    <QuestionFlow
      key={current.id}
      session={current}
      queue={waiting.filter((s) => s.id !== current.id)}
      onClose={onClose}
      onSent={() => setSent((prev) => new Set(prev).add(questionsKey(current)))}
    />
  );
}

/** The chats waiting after this one, with how many questions each has. */
function QueueStrip({ queue }: { queue: SessionSummary[] }) {
  if (!queue.length) return null;
  return (
    <div className="qf-queue">
      <span className="muted">Sedan:</span>
      {queue.map((s) => (
        <span key={s.id} className="qf-queue-item">
          <SessionMark name={s.name} icon={s.icon} color={s.color} size={14} />
          {s.name}
          <span className="qf-queue-count">{s.questions.length}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * One chat's questions and assumptions, one at a time in large text, each with its own answer box. More
 * from the same chat join the end while it is open. After the last one everything goes back to the agent
 * as one message, without a review step.
 */
function QuestionFlow({ session, queue, onClose, onSent }: { session: SessionSummary; queue: SessionSummary[]; onClose: () => void; onSent: () => void }) {
  const { questions } = session;
  const [byQuestion, setByQuestion] = useState<Drafts>(() => drafts.get(session.id));
  const answers = questions.map((q) => byQuestion[draftKey(q)] ?? '');
  const [index, setIndex] = useState(() => Math.max(0, answers.findIndex((a) => !a.trim())));
  useEffect(() => void drafts.set(session.id, byQuestion), [session.id, byQuestion]);

  const last = questions.length - 1;
  const at = Math.min(index, last);
  const q = questions[at];
  /** Sets the answer to question i; returns all answers with it. */
  const answerAt = (i: number, text: string): string[] => {
    const question = questions[i];
    if (question) setByQuestion((prev) => ({ ...prev, [draftKey(question)]: text }));
    return answers.map((a, k) => (k === i ? text : a));
  };
  const single = questions.length === 1;
  const submit = (current: string[] = answers): void => {
    // All skipped: nothing goes to the agent (it would only offer again and ask anew); the questions close.
    if (current.every((a) => !a.trim())) send('session:dismiss-callouts', { id: session.id });
    else send('session:send', { id: session.id, text: composeAnswers(questions, current) });
    drafts.delete(session.id);
    onSent();
  };
  /** On to the next question; after the last one, everything is sent. */
  const next = (current: string[] = answers): void => {
    if (at < last) setIndex(at + 1);
    else submit(current);
  };
  /** A one-click answer: set it and move on (or send, when it was the last question). */
  const answerWith = (text: string): void => next(answerAt(at, text));
  const quick = q && q.kind === 'question' ? (q.options.length ? q.options : quickAnswers(q.text)) : [];
  const queued = queue.reduce((n, s) => n + s.questions.length, 0);

  return (
    <Modal title={`${questions.length} ${questions.length === 1 ? 'fråga' : 'frågor'} till dig${queued ? ` · ${queued} till i kön` : ''}`} onClose={onClose} size="full">
      <div className="qf" style={{ '--accent': session.color } as CSSProperties}>
        <div className="qf-from" key={session.id} style={{ '--c': session.color } as CSSProperties}>
          <SessionMark name={session.name} icon={session.icon} color={session.color} size={26} />
          <span>{session.name}</span>
        </div>
        <QueueStrip queue={queue} />
        <div className="qf-steps" hidden={single}>
          {questions.map((item, i) => (
            <button
              key={i}
              type="button"
              className="qf-step-dot"
              data-kind={item.kind}
              data-current={i === at ? 'true' : undefined}
              data-answered={answers[i]?.trim() ? 'true' : undefined}
              title={item.text}
              onClick={() => setIndex(i)}
            >
              {i + 1}
            </button>
          ))}
          <button type="button" className="qf-step-dot qf-step-review" title="Skicka svaren nu" onClick={() => submit()}>
            Skicka
          </button>
        </div>

        {q && (
          <div className="qf-card" data-kind={q.kind}>
            <div className="qf-kind">
              {KIND_LABEL[q.kind]}
              <span className="qf-count">{at + 1} av {questions.length}</span>
            </div>
            <QuestionSource session={session} about={q.about} />
            {q.brief && <div className="qf-brief">{q.brief}</div>}
            <div className="qf-question" data-long={q.text.length > 90 ? (q.text.length > 180 ? 'very' : 'true') : undefined}>{q.text}</div>
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
                  <button key={option} type="button" className="btn qf-quick-btn" data-picked={answers[at] === option ? 'true' : undefined} onClick={() => answerWith(option)}>
                    {option}
                  </button>
                ))}
                <span className="muted">eller skriv ett eget svar nedan</span>
              </div>
            )}
            <textarea
              key={`${session.id}:${at}`}
              className="input qf-answer"
              rows={4}
              autoFocus
              value={answers[at] ?? ''}
              placeholder={q.kind === 'assumption' ? 'Rätta här om det är fel… (Enter: nästa, Skift+Enter: ny rad)' : 'Ditt svar… (Enter: nästa, Skift+Enter: ny rad)'}
              onChange={(e) => void answerAt(at, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  next();
                }
              }}
            />
            <div className="qf-actions">
              <button type="button" className="btn" disabled={at === 0} onClick={() => setIndex(at - 1)}>‹ Föregående</button>
              <span className="qf-spacer" />
              {q.kind === 'assumption' && (
                <button type="button" className="btn qf-ok" onClick={() => answerWith('Stämmer.')}>
                  Stämmer
                </button>
              )}
              <button type="button" className="btn" onClick={() => next()}>Hoppa över</button>
              <button type="button" className="btn primary" onClick={() => next()}>{at < last ? 'Nästa ›' : queue.length ? 'Skicka · nästa chatt ›' : 'Skicka'}</button>
            </div>
          </div>
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
  const [answers, setAnswers] = useState<string[]>(() => {
    const saved = drafts.get(session.id);
    return questions.map((q) => saved[draftKey(q)] ?? '');
  });
  const index = answers.findIndex((a) => !a.trim());
  const q = index === -1 ? undefined : questions[index];
  if (!q) return null;
  const options = q.kind === 'assumption' ? ['Stämmer'] : q.options.length ? q.options : quickAnswers(q.text);
  const choose = (text: string): void => {
    const updated = answers.map((a, i) => (i === index ? text : a));
    if (updated.every((a) => a.trim())) {
      send('session:send', { id: session.id, text: composeAnswers(questions, updated) });
      drafts.delete(session.id);
    } else {
      drafts.set(session.id, { ...drafts.get(session.id), [draftKey(q)]: text });
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
