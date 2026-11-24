// turn-tags: after a turn, a cheap model tags the main agent's messages, without rewriting them: which
// questions and choices are put to the user (with their options and a short background) and which messages
// the user must see. The UI acts on the tags (question flow, never folding those messages). Builds the
// request and reads the reply; the composition root makes the call.
import type { OpenQuestion, StructuredRequest } from '../../../shared/contracts';

const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4000;
const MAX_BRIEF_CHARS = 240;

export interface TurnTags {
  questions: Array<Omit<OpenQuestion, 'context' | 'detail'> & { message: number }>;
  /** 1-based numbers of the messages the user must see. */
  keep: number[];
}

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['question', 'assumption'] },
          options: { type: 'array', items: { type: 'string' } },
          brief: { type: 'string' },
          message: { type: 'integer' },
        },
        required: ['text', 'kind', 'options', 'brief', 'message'],
        additionalProperties: false,
      },
    },
    keep: { type: 'array', items: { type: 'integer' } },
  },
  required: ['questions', 'keep'],
  additionalProperties: false,
};

/** The messages that go along: the last ones of the turn, each cut to a sane length. */
export function messagesForTagging(texts: string[]): string[] {
  return texts.slice(-MAX_MESSAGES).map((t) => (t.length > MAX_MESSAGE_CHARS ? `${t.slice(0, MAX_MESSAGE_CHARS)}…` : t));
}

export function tagRequest(messages: string[], cwd: string): StructuredRequest {
  const numbered = messages.map((m, i) => `[${i + 1}]\n${m}`).join('\n\n');
  const prompt = [
    'Nedan är en AI-agents meddelanden till användaren under en arbetstur, numrerade. Tagga dem; skriv inte om något.',
    '1. questions: varje fråga eller val agenten vill att användaren svarar på eller tar ställning till, och varje antagande användaren ska bekräfta.',
    '   Bara det som uttryckligen ber användaren svara, välja eller bekräfta något. Lägesrapporter, resultat, listor över vad som gjorts eller ska göras, rubriker och förklaringar är aldrig frågor, inte heller när de står i punktlistor eller efter ett kolon.',
    '   Ta inte med frågor som agenten själv besvarar i samma tur. Hellre en fråga för lite än en påhittad. För varje:',
    '   text: frågan med agentens egna ord, kort; kind: "question" eller "assumption";',
    '   options: svarsalternativen om agenten gav några (t.ex. ["1", "1b"] eller ["A", "B"]), annars [];',
    '   brief: en till två meningar, högst 200 tecken, med det användaren behöver veta för att svara direkt, bara från texten;',
    '   message: numret på meddelandet där frågan står.',
    '2. keep: numren på meddelanden användaren måste se: med frågor eller val, beslut, resultat, problem, bilder eller länkar. Utelämna rena lägesrapporter.',
    'Svara med JSON.',
    '',
    numbered,
  ].join('\n');
  return { prompt, schema: SCHEMA, model: 'haiku', cwd, tools: [], maxTurns: 3 };
}

/** The tags from the reply, checked against the number of messages; null when the reply is unusable. */
export function readTags(reply: unknown, count: number): TurnTags | null {
  if (typeof reply !== 'object' || reply === null) return null;
  const r = reply as { questions?: unknown; keep?: unknown };
  if (!Array.isArray(r.questions) || !Array.isArray(r.keep)) return null;
  const inRange = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= count;
  const questions = r.questions.flatMap((q): TurnTags['questions'] => {
    if (typeof q !== 'object' || q === null) return [];
    const x = q as Record<string, unknown>;
    const text = typeof x['text'] === 'string' ? x['text'].trim() : '';
    if (!text || !inRange(x['message'])) return [];
    const brief = typeof x['brief'] === 'string' ? x['brief'].trim() : '';
    return [
      {
        text,
        kind: x['kind'] === 'assumption' ? 'assumption' : 'question',
        options: Array.isArray(x['options']) ? x['options'].filter((o): o is string => typeof o === 'string' && !!o.trim()).map((o) => o.trim()).slice(0, 6) : [],
        brief: brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS - 1)}…` : brief,
        message: x['message'] as number,
      },
    ];
  });
  return { questions, keep: [...new Set(r.keep.filter(inRange))] };
}
