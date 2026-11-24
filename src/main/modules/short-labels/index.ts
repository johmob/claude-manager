// short-labels: short labels for long work-schema titles, so the tree reads at a glance even when an agent
// wrote whole sentences as titles. A cheap model writes a label of a few words per title; the agent's file
// is never changed. Builds the request and reads the reply; the composition root makes the call and keeps
// the labels.
import type { StructuredRequest } from '../../../shared/contracts';

const LONG_TITLE_CHARS = 32;
const LONG_TITLE_WORDS = 5;
const MAX_LABEL_CHARS = 40;
const MAX_TITLES = 60;

/** Whether a title is long enough to need a short label in the tree. */
export function needsLabel(title: string): boolean {
  const t = title.trim();
  return t.length > LONG_TITLE_CHARS || t.split(/\s+/).length > LONG_TITLE_WORDS;
}

const SCHEMA = {
  type: 'object',
  properties: { labels: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, label: { type: 'string' } }, required: ['n', 'label'], additionalProperties: false } } },
  required: ['labels'],
  additionalProperties: false,
};

export function labelRequest(titles: string[], cwd: string): StructuredRequest {
  const prompt = [
    'Nedan är rubriker ur ett projekts arbetsschema, numrerade. Skriv en kort etikett för varje: högst fyra ord, en substantivfras som säger vad det gäller,',
    'på samma språk som rubriken. Behåll beteckningar, namn och nyckelord (t.ex. "OTA", "SPI", "v2"). Ingen punkt på slutet. Svara med JSON.',
    '',
    ...titles.slice(0, MAX_TITLES).map((t, i) => `[${i + 1}] ${t}`),
  ].join('\n');
  return { prompt, schema: SCHEMA, model: 'haiku', cwd, tools: [], maxTurns: 3 };
}

/** The label for each title, in order ('' where the reply has none). */
export function readLabels(reply: unknown, count: number): string[] {
  const out = Array.from({ length: Math.min(count, MAX_TITLES) }, () => '');
  const list = typeof reply === 'object' && reply !== null ? (reply as { labels?: unknown }).labels : null;
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const { n, label } = item as { n?: unknown; label?: unknown };
    if (typeof n !== 'number' || typeof label !== 'string' || n < 1 || n > out.length) continue;
    out[n - 1] = label.trim().replace(/\.$/, '').slice(0, MAX_LABEL_CHARS);
  }
  return out;
}
