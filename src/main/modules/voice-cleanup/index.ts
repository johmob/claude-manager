// voice-cleanup: rewrites a transcribed utterance into a clear written instruction. Builds the request and
// reads the reply; the composition root makes the call. Falls back to the original text whenever the reply
// is not a usable rewrite, so a failed clean-up never loses what the user said.
import type { StructuredRequest } from '../../../shared/contracts';

const SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
};

const MAX_RATIO = 3;
const MIN_RATIO = 0.3;

export function cleanupRequest(text: string, cwd: string): StructuredRequest {
  const prompt = [
    'Texten nedan är tal som transkriberats automatiskt och ska skickas som ett meddelande till en kodagent. Skriv om den till en tydlig skriftlig instruktion på samma språk. Behåll allt innehåll och all betydelse, lägg inte till något, svara inte på den. Ta bort utfyllnadsord, omtagningar och upprepningar. Rätta uppenbara hörfel med hjälp av sammanhanget (tekniska ord, filnamn). Behåll namn, siffror och kod exakt.',
    '',
    'Svara med JSON: {"text": "..."}.',
    '',
    '<transkript>',
    text,
    '</transkript>',
  ].join('\n');
  return { prompt, schema: SCHEMA, model: 'haiku', cwd, tools: [], maxTurns: 3 };
}

/** The rewritten text, or the original when the reply is malformed, empty, or not a plausible rewrite. */
export function readCleanup(reply: unknown, original: string): string {
  const value = typeof reply === 'object' && reply !== null ? (reply as { text?: unknown }).text : undefined;
  if (typeof value !== 'string') return original;
  const text = value.trim();
  if (!text) return original;
  const ratio = text.length / Math.max(1, original.trim().length);
  if (ratio > MAX_RATIO || ratio < MIN_RATIO) return original;
  return text;
}
