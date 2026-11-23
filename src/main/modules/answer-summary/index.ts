// answer-summary: a short version of a long answer, written by a cheap model, for small spaces such as
// the quick chat folded out in the overlay. The full answer stays one click away. Builds the request and
// reads the reply; the composition root makes the call.
import type { StructuredRequest } from '../../../shared/contracts';

/** Answers up to this length are shown as they are. */
export const SUMMARY_THRESHOLD = 350;
const MAX_INPUT_CHARS = 12000;
const MAX_SUMMARY_CHARS = 420;

const SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
  additionalProperties: false,
};

export function summaryRequest(question: string, answer: string, cwd: string): StructuredRequest {
  const text = answer.length > MAX_INPUT_CHARS ? `${answer.slice(0, MAX_INPUT_CHARS)}…` : answer;
  const prompt = [
    'Sammanfatta svaret nedan till högst 50 ord på svenska, så att det går att läsa i en liten ruta.',
    'Svara direkt på frågan med det viktigaste: behåll siffror, namn och slutsatser, ingen inledning och inga rubriker.',
    'Använd bara det som står i svaret. Svara med JSON {"summary": "..."}.',
    '',
    `Fråga: ${question}`,
    '',
    'Svar:',
    '<<<',
    text,
    '>>>',
  ].join('\n');
  return { prompt, schema: SCHEMA, model: 'haiku', cwd, tools: [], maxTurns: 3 };
}

export function readSummary(reply: unknown): string {
  const summary = typeof reply === 'object' && reply !== null && typeof (reply as { summary?: unknown }).summary === 'string' ? (reply as { summary: string }).summary.trim() : '';
  return summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS - 1)}…` : summary;
}
