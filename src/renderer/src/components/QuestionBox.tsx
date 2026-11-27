import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { OpenQuestion, SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';
import { composeAnswers, draftKey, drafts, onDraftsChanged } from '../lib/questionAnswers';
import { quickAnswers } from '../lib/quickAnswers';
import { useReveal } from '../lib/revealQuestions';
import { MarkdownText } from './MarkdownText';
import { SessionMark } from './SessionMark';
import '../styles/questions.css';

/** Opens a session's chat at its questions; provided by the window that shows chats. */
export const AskQuestionsContext = createContext<(sessionId: string) => void>(() => undefined);

/** Identifies one set of questions: a turn that leaves new questions gives a new key. */
export function questionsKey(session: SessionSummary): string {
  return `${session.id}:${session.questionsId}`;
}

const KIND_LABEL: Record<OpenQuestion['kind'], string> = { question: 'Fråga', assumption: 'Antagande – stämmer det?' };

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

/** Quick answers for a question: its own options, else a guess from its wording, else "Stämmer" for an assumption. */
function quickFor(q: OpenQuestion): string[] {
  if (q.kind === 'assumption') return ['Stämmer'];
  return q.options.length ? q.options : quickAnswers(q.text);
}

/**
 * The questions and assumptions at the end of the chat: every one as a card with its own answer field,
 * and one button that sends them all as a single message. Quick buttons only fill in the answer. Hidden
 * once sent, until the agent asks anew.
 */
export function QuestionBox({ session }: { session: SessionSummary }) {
  const { questions } = session;
  const [byQuestion, setByQuestion] = useState(() => drafts.get(session.id));
  const [sentKey, setSentKey] = useState<string | null>(null);
  const boxRef = useRef<HTMLElement>(null);
  const fields = useRef<(HTMLTextAreaElement | null)[]>([]);
  const answers = questions.map((q) => byQuestion[draftKey(q)] ?? '');
  const key = questionsKey(session);

  useEffect(() => void drafts.set(session.id, byQuestion), [session.id, byQuestion]);
  // One-click answers given in the overlay arrive through the shared storage.
  useEffect(() => onDraftsChanged(session.id, () => setByQuestion(drafts.get(session.id))), [session.id]);
  useReveal(session.id, boxRef, () => {
    boxRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    (fields.current.find((f, i) => f && !answers[i]?.trim()) ?? fields.current[0])?.focus({ preventScroll: true });
  });

  if (!questions.length || sentKey === key) return null;

  const setAnswer = (i: number, text: string): void => {
    const q = questions[i];
    if (q) setByQuestion((prev) => ({ ...prev, [draftKey(q)]: text }));
  };
  const close = (): void => {
    drafts.delete(session.id);
    setByQuestion({});
    setSentKey(key);
  };
  const submit = (): void => {
    // All skipped: nothing goes to the agent (it would only offer again and ask anew); the questions close.
    if (answers.every((a) => !a.trim())) send('session:dismiss-callouts', { id: session.id });
    else send('session:send', { id: session.id, text: composeAnswers(questions, answers) });
    close();
  };
  const skipAll = (): void => {
    send('session:dismiss-callouts', { id: session.id });
    close();
  };
  // With a single question a quick answer is the whole reply, so it goes at once; with several it only fills in.
  const pick = (i: number, value: string): void => {
    if (questions.length !== 1) return setAnswer(i, value);
    send('session:send', { id: session.id, text: composeAnswers(questions, [value]) });
    close();
  };
  const assumptions = questions.filter((q) => q.kind === 'assumption').length;

  return (
    <section ref={boxRef} className="qbox" style={{ '--accent': session.color } as CSSProperties}>
      <div className="qbox-head">
        <strong>{questions.length} {questions.length === 1 ? 'fråga' : 'frågor'} till dig</strong>
        {assumptions > 0 && <span className="muted"> · varav {assumptions} {assumptions === 1 ? 'antagande' : 'antaganden'}</span>}
      </div>
      {questions.map((q, i) => {
        const quick = quickFor(q);
        return (
          <div key={draftKey(q)} className="qbox-card" data-kind={q.kind}>
            <div className="qbox-kind">
              {KIND_LABEL[q.kind]}
              <span className="qbox-count">{i + 1} av {questions.length}</span>
            </div>
            <QuestionSource session={session} about={q.about} />
            {q.brief && <div className="qf-brief">{q.brief}</div>}
            <div className="qbox-text">{q.text}</div>
            {q.detail && (
              <div className="qf-detail qbox-detail">
                <MarkdownText text={q.detail} />
              </div>
            )}
            {quick.length > 0 && (
              <div className="qf-quick">
                {quick.map((option) => {
                  const value = option === 'Stämmer' ? 'Stämmer.' : option;
                  return (
                    <button key={option} type="button" className="btn qf-quick-btn" data-picked={answers[i] === value ? 'true' : undefined} onClick={() => pick(i, value)}>
                      {option}
                    </button>
                  );
                })}
              </div>
            )}
            <textarea
              ref={(el) => void (fields.current[i] = el)}
              className="input qbox-answer"
              rows={2}
              value={answers[i] ?? ''}
              placeholder={q.kind === 'assumption' ? 'Rätta här om det är fel…' : 'Ditt svar…'}
              onChange={(e) => setAnswer(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (e.ctrlKey) {
                  e.preventDefault();
                  submit();
                } else if (!e.shiftKey) {
                  e.preventDefault();
                  const nextField = fields.current[i + 1];
                  if (nextField) nextField.focus();
                  else submit();
                }
              }}
            />
          </div>
        );
      })}
      <div className="qbox-foot">
        <button type="button" className="btn" onClick={skipAll}>Hoppa över alla</button>
        <span className="qbox-hint muted">
          {questions.length === 1 ? 'Ett klick på ett snabbsvar skickar direkt · Enter: skicka' : 'Enter: nästa fält · Ctrl+Enter: skicka'}
        </span>
        <button type="button" className="btn primary" onClick={submit}>Skicka svaren</button>
      </div>
    </section>
  );
}

/** Prominent "Svara på 8 frågor" on a card; opens the chat at its questions. */
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
 * buttons. Each click fills in the answer (shared with the chat's box); the last one sends all answers in
 * one message. Questions that need written answers, and "read more", open the chat at its questions.
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
  const options = quickFor(q);
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
