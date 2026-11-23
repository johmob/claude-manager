// One-off edit script (deleted after use).
const fs = require('fs');
const edit = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(file + ' missing: ' + a.slice(0, 80));
    s = s.replace(a, b);
  }
  fs.writeFileSync(file, s);
};
const qf = 'src/renderer/src/components/QuestionFlow.tsx';
let s = fs.readFileSync(qf, 'utf8');
s += `
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
  const options = q.kind === 'assumption' ? ['Stämmer'] : quickAnswers(q.text);
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
        <span>{q.kind === 'assumption' ? 'Antagande' : 'Fråga'}{questions.length > 1 ? \` \${index + 1} av \${questions.length}\` : ''}</span>
        <span className="muted">{session.name}</span>
      </div>
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
`;
fs.writeFileSync(qf, s);

edit('src/renderer/src/windows/OverlayWindow.tsx', [
  [`import { SessionInfo } from '../components/SessionInfo';`, `import { QuickQuestion, questionsKey } from '../components/QuestionFlow';
import { SessionInfo } from '../components/SessionInfo';`],
  [`setInteractive(e.ctrlKey || (e.target instanceof Element && !!e.target.closest('.ov-cell')))`, `setInteractive(e.ctrlKey || (e.target instanceof Element && !!e.target.closest('.ov-cell, .ov-q')))`],
  [`          {hovered === 'usage' ? <UsageDetail usage={state.usage} /> : session && <SessionInfo session={session} account={state.account} />}`,
   `          {hovered === 'usage' ? (
            <UsageDetail usage={state.usage} />
          ) : session?.questions.length ? (
            <QuickQuestion key={questionsKey(session)} session={session} onOpen={() => send('popup:open', { kind: 'questions', id: session.id })} />
          ) : (
            session && <SessionInfo session={session} account={state.account} />
          )}`],
]);
fs.writeFileSync('src/renderer/src/styles.css', fs.readFileSync('src/renderer/src/styles.css', 'utf8') + `
/* A question answered straight from the overlay */
.ov-q { display: flex; flex-direction: column; gap: 10px; }
.ov-q-head { display: flex; justify-content: space-between; gap: 8px; font-size: 0.6875rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #facc15; }
.ov-q-head .muted { text-transform: none; letter-spacing: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ov-q-text { font-size: 0.95rem; font-weight: 650; line-height: 1.4; color: #fff; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.ov-q-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ov-q-actions .qf-quick-btn { padding: 6px 16px; min-width: 64px; }
`);
console.log('ok');
