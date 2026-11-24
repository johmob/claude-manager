// compact-check: after the agent has been asked to prepare for compacting, a cheap model judges whether its
// answer says it is ready. Builds the request and reads the reply; the composition root makes the call.
import type { StructuredRequest } from '../../../shared/contracts';

export type CompactVerdict = 'ready' | 'not_ready' | 'unclear';
const VERDICTS: readonly string[] = ['ready', 'not_ready', 'unclear'];
const MAX_INPUT_CHARS = 6000;
const MAX_REASON_CHARS = 300;

const SCHEMA = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['ready', 'not_ready', 'unclear'] }, reason: { type: 'string' } },
  required: ['verdict', 'reason'],
  additionalProperties: false,
};

export function compactCheckRequest(answer: string, cwd: string): StructuredRequest {
  const text = answer.length > MAX_INPUT_CHARS ? `${answer.slice(0, MAX_INPUT_CHARS)}…` : answer;
  const prompt = [
    'En agent har bett om att förbereda sig för att samtalet komprimeras (sparat det som måste överleva och svarat om den är redo).',
    'Bedöm agentens svar nedan: "ready" om svaret tydligt säger att den är redo och inget viktigt återstår, "not_ready" om den säger att den inte är redo eller att något måste göras först, annars "unclear".',
    'Ange en kort orsak på svenska (en mening). Svara med JSON {"verdict": "...", "reason": "..."}.',
    '',
    'Svar:',
    '<<<',
    text,
    '>>>',
  ].join('\n');
  return { prompt, schema: SCHEMA, model: 'haiku', cwd, tools: [], maxTurns: 3 };
}

export function readCompactCheck(reply: unknown): { verdict: CompactVerdict; reason: string } | null {
  if (typeof reply !== 'object' || reply === null) return null;
  const { verdict, reason } = reply as { verdict?: unknown; reason?: unknown };
  if (typeof verdict !== 'string' || !VERDICTS.includes(verdict)) return null;
  const text = typeof reason === 'string' ? reason.trim() : '';
  return { verdict: verdict as CompactVerdict, reason: text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 1)}…` : text };
}
