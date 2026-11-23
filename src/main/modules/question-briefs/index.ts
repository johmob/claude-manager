// question-briefs: short backgrounds for the questions a turn ends with, written by a cheap model from
// the agent's own answer, so a question can be answered at a glance (overlay, question flow). Builds the
// request and reads the reply; the composition root makes the call.
import type { OpenQuestion, StructuredRequest } from '../../../shared/contracts';

/** How much of the agent's answer goes along; questions come at its end, so the end is kept. */
const MAX_ANSWER_CHARS = 8000;
const MAX_BRIEF_CHARS = 240;

const SCHEMA = {
  type: 'object',
  properties: { briefs: { type: 'array', items: { type: 'string' } } },
  required: ['briefs'],
  additionalProperties: false,
};

export function briefRequest(questions: OpenQuestion[], answer: string, cwd: string): StructuredRequest {
  const text = answer.length > MAX_ANSWER_CHARS ? `…${answer.slice(-MAX_ANSWER_CHARS)}` : answer;
  const list = questions.map((q, i) => `${i + 1}. ${q.kind === 'assumption' ? 'Antagande: ' : ''}${q.text}`).join('\n');
  const prompt = [
    'En AI-agent har avslutat ett svar med frågor till användaren. Skriv en kort bakgrund till varje fråga:',
    'en till två meningar på svenska, högst 200 tecken, med det användaren behöver veta för att svara direkt',
    '(vad saken gäller och vad alternativen innebär). Använd bara det som står i agentens svar; hitta inte på något.',
    'Upprepa inte frågan. Svara med JSON {"briefs": [...]}, en text per fråga i samma ordning.',
    '',
    'Agentens svar:',
    '<<<',
    text,
    '>>>',
    '',
    'Frågor:',
    list,
  ].join('\n');
  return { prompt, schema: SCHEMA, model: 'haiku', cwd, tools: [], maxTurns: 3 };
}

/** The briefs from the reply, one per question ('' where missing), trimmed to a short length. */
export function readBriefs(reply: unknown, count: number): string[] {
  const briefs = typeof reply === 'object' && reply !== null && Array.isArray((reply as { briefs?: unknown }).briefs) ? (reply as { briefs: unknown[] }).briefs : [];
  return Array.from({ length: count }, (_, i) => {
    const brief = typeof briefs[i] === 'string' ? (briefs[i] as string).trim() : '';
    return brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS - 1)}…` : brief;
  });
}
