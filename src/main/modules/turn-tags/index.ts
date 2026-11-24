// turn-tags: after a turn, a cheap model reads the main agent's messages and tags them, without rewriting
// anything: every block (paragraph, list, table, code block) gets a tag saying what it is (result, passed
// check, failure, question, background …), and the questions and choices put to the user are listed with
// their options and a short background. The UI acts on the tags (styling, folding, the question flow).
// Builds the request and reads the reply; the composition root makes the call.
import { BLOCK_TAGS, type BlockTag, type OpenQuestion, type StructuredRequest, type TaggedBlock } from '../../../shared/contracts';

const MAX_MESSAGES = 12;
const MAX_BLOCKS = 80;
const MAX_BLOCK_CHARS = 1500;
const MAX_BRIEF_CHARS = 240;
const MAX_ABOUT_CHARS = 100;

export interface TurnTags {
  questions: Array<Omit<OpenQuestion, 'detail'> & { message: number }>;
  /** Per message, per block: its tag (null when the model gave none). */
  tags: Array<Array<BlockTag | null>>;
}

const SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, tag: { type: 'string', enum: [...BLOCK_TAGS] } },
        required: ['id', 'tag'],
        additionalProperties: false,
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['question', 'assumption'] },
          options: { type: 'array', items: { type: 'string' } },
          about: { type: 'string' },
          brief: { type: 'string' },
          message: { type: 'integer' },
        },
        required: ['text', 'kind', 'about', 'options', 'brief', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['blocks', 'questions'],
  additionalProperties: false,
};

const HEADING = /^\s*(?:#{1,6}\s.+|(?:\*\*|__)[^\n]+(?:\*\*|__)\s*:?|[^\n]{1,100}:)\s*$/;

/**
 * A message split into blocks at blank lines, never inside a code block. A lone heading (or a short line
 * ending in a colon) stays with the block after it.
 */
export function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = (): void => {
    if (current.some((l) => l.trim())) blocks.push(current.join('\n').trim());
    current = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && !line.trim()) {
      const filled = current.filter((l) => l.trim());
      if (filled.length === 1 && HEADING.test(filled[0]!)) {
        current.push(line);
        continue;
      }
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/** The last messages of the turn that fit, each split into blocks; older messages go first when there are too many blocks. */
export function messagesForTagging(texts: string[]): string[][] {
  const split = texts.slice(-MAX_MESSAGES).map(splitBlocks);
  let total = split.reduce((n, b) => n + b.length, 0);
  while (split.length > 1 && total > MAX_BLOCKS) total -= split.shift()!.length;
  return split;
}

/** `work`: the work schema's items in progress ("id title"), so a question can be tied to its step. */
export function tagRequest(messages: string[][], cwd: string, work: string[] = []): StructuredRequest {
  const numbered = messages
    .map((blocks, m) => blocks.map((b, i) => `[${m + 1}.${i + 1}]\n${b.length > MAX_BLOCK_CHARS ? `${b.slice(0, MAX_BLOCK_CHARS)}…` : b}`).join('\n\n'))
    .join('\n\n');
  const prompt = [
    'Nedan är en AI-agents meddelanden till användaren under en arbetstur, uppdelade i block med nummer [meddelande.block]. Tagga dem; skriv inte om något.',
    '1. blocks: en tagg för varje block, med blockets nummer som id (t.ex. "2.3"). Välj den som bäst beskriver vad blocket är för användaren:',
    '   answer: ett direkt svar på det användaren frågade.',
    '   result: vad som gjorts, byggts eller ändrats; ett utfall.',
    '   pass: en kontroll, ett test eller en verifiering som gick igenom.',
    '   fail: något som misslyckades, är trasigt eller inte fungerar.',
    '   warning: en begränsning, något som hoppades över, är osäkert eller bör bevakas.',
    '   risk: något destruktivt, oåterkalleligt eller säkerhetsrelaterat.',
    '   question: ber uttryckligen användaren svara eller välja.',
    '   assumption: något agenten antagit som användaren bör bekräfta eller rätta.',
    '   decision: ett val agenten gjort på egen hand.',
    '   next: ett förslag på nästa steg.',
    '   plan: vad agenten ska göra härnäst.',
    '   progress: rutinmässig lägesrapport på vägen.',
    '   background: förklaring, sammanhang, resonemang.',
    '   Ett block med blandat innehåll får taggen för det viktigaste det innehåller (fail före warning före result).',
    '2. questions: varje fråga eller val agenten uttryckligen ber användaren svara på eller ta ställning till, och varje antagande användaren ska bekräfta.',
    '   Rutor märkta [!NOTE] är antaganden bara om agenten antagit något i användarens ställe som användaren kan rätta; information, osäkerheter agenten själv nämner och förklaringar är inga antaganden att bekräfta.',
    '   Lägesrapporter, resultat, listor över vad som gjorts eller ska göras, rubriker och förklaringar är aldrig frågor, inte heller i punktlistor eller efter ett kolon.',
    '   Ta inte med frågor som agenten själv besvarar i samma tur. Hellre en fråga för lite än en påhittad. För varje:',
    '   Användaren har många agenter och projekt igång och läser frågan utan resten av texten, så den måste gå att förstå fristående.',
    '   text: frågan med agentens ord, kort, men med det tillagt som behövs för att förstå den fristående (vilken modell, del eller version den gäller; "Är skruvarna M3?" blir "Är skruvarna i handtag v4 M3?"); kind: "question" eller "assumption";',
    '   about: vad frågan gäller, högst 80 tecken: modell, del, version eller delmoment med agentens namn på dem (t.ex. "Handtag v4, kåpan mot greppet"), och punktens id ur arbetsschemat först om det framgår vilken punkt det är (t.ex. "cad.2.1 Handtag v4: kåpan"); "" om det inte framgår;',
    '   options: svarsalternativen om agenten gav några (t.ex. ["1", "1b"] eller ["A", "B"]), annars [];',
    '   brief: en till två meningar, högst 200 tecken, med det användaren behöver veta för att svara direkt, bara från texten, och som nämner vad det gäller;',
    '   message: numret på meddelandet där frågan står.',
    'Svara med JSON.',
    '',
    ...(work.length ? ['Pågående punkter i arbetsschemat:', ...work.map((w) => `- ${w}`), ''] : []),
    'Meddelandena:',
    numbered,
  ].join('\n');
  return { prompt, schema: SCHEMA, model: 'haiku', cwd, tools: [], maxTurns: 3 };
}

/** The tags from the reply, checked against the messages' blocks; null when the reply is unusable. */
export function readTags(reply: unknown, blockCounts: number[]): TurnTags | null {
  if (typeof reply !== 'object' || reply === null) return null;
  const r = reply as { blocks?: unknown; questions?: unknown };
  if (!Array.isArray(r.blocks) || !Array.isArray(r.questions)) return null;
  const tags = blockCounts.map((n) => Array.from({ length: n }, (): BlockTag | null => null));
  for (const b of r.blocks) {
    if (typeof b !== 'object' || b === null) continue;
    const { id, tag } = b as { id?: unknown; tag?: unknown };
    const at = typeof id === 'string' ? /^(\d+)\.(\d+)$/.exec(id.trim()) : null;
    if (!at || !(BLOCK_TAGS as readonly unknown[]).includes(tag)) continue;
    const row = tags[Number(at[1]) - 1];
    const i = Number(at[2]) - 1;
    if (row && i >= 0 && i < row.length) row[i] = tag as BlockTag;
  }
  const inRange = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= blockCounts.length;
  const questions = r.questions.flatMap((q): TurnTags['questions'] => {
    if (typeof q !== 'object' || q === null) return [];
    const x = q as Record<string, unknown>;
    const text = typeof x['text'] === 'string' ? x['text'].trim() : '';
    if (!text || !inRange(x['message'])) return [];
    const brief = typeof x['brief'] === 'string' ? x['brief'].trim() : '';
    const about = typeof x['about'] === 'string' ? x['about'].trim().slice(0, MAX_ABOUT_CHARS) : '';
    return [
      {
        text,
        kind: x['kind'] === 'assumption' ? 'assumption' : 'question',
        about,
        options: Array.isArray(x['options']) ? x['options'].filter((o): o is string => typeof o === 'string' && !!o.trim()).map((o) => o.trim()).slice(0, 6) : [],
        brief: brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS - 1)}…` : brief,
        message: x['message'] as number,
      },
    ];
  });
  return { questions, tags };
}

/** A message's blocks with their tags, for the transcript. */
export function taggedBlocks(blocks: string[], tags: Array<BlockTag | null>): TaggedBlock[] {
  return blocks.map((text, i) => ({ text, tag: tags[i] ?? null }));
}
