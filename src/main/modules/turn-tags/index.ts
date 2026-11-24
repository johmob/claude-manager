// turn-tags: after a turn, a cheap model reads the main agent's messages and tags them, without rewriting
// anything: every block (paragraph, list, table, code block) gets a tag saying what it is (result, passed
// check, failure, question, background …), and the questions and choices put to the user are listed with
// their options and a short background. The UI acts on the tags (styling, folding, the question flow).
// Builds the request and reads the reply; the composition root makes the call.
import { ANSWER_ROOM_CHARS } from '../../../shared/answerRoom';
import { BLOCK_TAGS, type BlockTag, type OpenQuestion, type StructuredRequest, type TaggedBlock } from '../../../shared/contracts';

const MAX_MESSAGES = 12;
const MAX_BLOCKS = 80;
const MAX_BLOCK_CHARS = 1500;
const MAX_BRIEF_CHARS = 240;
const MAX_ABOUT_CHARS = 100;

export interface TurnTags {
  /** `context`: the blocks (message, block; 1-based) the user needs to see to answer: pictures, tables, the options compared. */
  questions: Array<Omit<OpenQuestion, 'detail'> & { message: number; context: Array<[number, number]> }>;
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
          repeats: { type: 'boolean' },
          context: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'kind', 'about', 'options', 'brief', 'message', 'repeats', 'context'],
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

/**
 * `work`: the work schema's items in progress ("id title"), so a question can be tied to its step.
 * `asked`: questions already waiting for the user and ones the user answered lately, so the same question
 * is not asked again in other words.
 */
export function tagRequest(messages: string[][], cwd: string, work: string[] = [], asked: { open: string[]; answered: string[] } = { open: [], answered: [] }): StructuredRequest {
  const numbered = messages
    .map((blocks, m) => blocks.map((b, i) => `[${m + 1}.${i + 1}]\n${b.length > MAX_BLOCK_CHARS ? `${b.slice(0, MAX_BLOCK_CHARS)}…` : b}`).join('\n\n'))
    .join('\n\n');
  const prompt = [
    'Du hjälper en användare som styr många AI-agenter i olika projekt samtidigt och bara hinner skumma det de skriver. Nedan är en agents meddelanden från en arbetstur, uppdelade i block med nummer [meddelande.block]. Ditt jobb är att avgöra vad användaren behöver se, så att det viktiga syns direkt och resten håller sig undan. Du skriver inte om något.',
    '',
    'Hur appen använder det du svarar:',
    '- Varje block får en tagg. Användaren läser chatten på en av tre nivåer. Minimal visar bara answer, question, assumption, fail, risk och warning. Moderat visar också result, pass, decision och next. Detaljerat visar allt.',
    '- Block som bara är plan, progress eller background tonas ned. Består ett meddelande bara av sådana fälls det in i rutan "Under arbetet", som visar det senaste meddelandet på två rader medan agenten arbetar och annars är ihopfälld. Där passar löpande berättande; det användaren måste göra eller veta hör inte hemma där.',
    `- Svaret (det sista meddelandet) visar ungefär ${ANSWER_ROOM_CHARS} tecken. Block på användarens nivå visas alltid och resten fylls på i ordning upp till den längden. Ett kort svar visas därför helt; i ett långt svar ska bara riktig utfyllnad få taggen plan, progress eller background.`,
    '- Varje fråga i questions öppnas i ett eget fönster som användaren läser långt senare, utan resten av texten, bland frågor från andra projekt. text visas som en stor rubrik, brief som en kort ingress ovanför, och blocken i context visas under rubriken som underlag.',
    '',
    'Vad som står på spel: att dölja något användaren måste göra, svara på, bestämma eller känna till (nästa steg, vad som inte är klart, vad som är committat eller släppt, risker) är dyrt. Att visa en rad för mycket är billigt. Att ställa en fråga som inte är en äkta fråga är dyrt, eftersom den avbryter användaren; samma fråga två gånger likaså. Välj utifrån det, inte efter ytliga ord som frågetecken eller kolon.',
    '',
    'Taggarna: answer (svar på det användaren frågade), result (vad som gjorts eller blev resultatet), pass (en kontroll som gick igenom), fail (något som misslyckades), warning (en begränsning, något överhoppat eller osäkert), risk (destruktivt, oåterkalleligt, säkerhet), question (ber användaren svara eller välja), assumption (något agenten antagit i användarens ställe som användaren kan rätta), decision (ett val agenten gjort själv), next (nästa steg att ta ställning till), plan (vad agenten ska göra), progress (rutinmässig lägesrapport), background (förklaring och resonemang). Ett block med blandat innehåll får taggen för det viktigaste i det.',
    '',
    'questions: de äkta frågor och val agenten ber användaren ta ställning till, och de antaganden användaren bör bekräfta. Rutor märkta [!QUESTION] är frågor från agenten och ska med. Rutor märkta [!NOTE] är bara antaganden om agenten verkligen antagit något i användarens ställe; information och sådant som ska verifieras senare är det inte. Det som agenten själv besvarar i turen är ingen fråga. Hellre en fråga för lite än en påhittad. Per fråga:',
    '- text: frågan, kort nog för en rubrik (helst under 90 tecken) och begriplig fristående. Lägg detaljer, värden och villkor i brief, inte i rubriken. Inga markeringar som [!QUESTION] och inga block-id.',
    '- kind: "question" eller "assumption". about: vad det gäller, högst 80 tecken, med arbetsschemats punkt-id först om det framgår (t.ex. "cad.2.1 Handtag v4: kåpan"), annars "".',
    '- options: svarsalternativen agenten gav, annars []. brief: en till två meningar, högst 200 tecken, med det användaren behöver veta för att svara; skriv aldrig block-id eller "se block" där.',
    '- message: meddelandets nummer. context: id på de block användaren behöver se för att svara (bilder, länkar, tabeller, alternativ, mätvärden), även från tidigare meddelanden. Bilder och länkar som frågan gäller ska alltid med, också när blocket i övrigt är bakgrund. Inte blocket som bara upprepar frågan själv; [] om frågan räcker.',
    '- repeats: true om den frågar samma sak som en fråga i listorna nedan, även med andra ord; annars false.',
    'Svara med JSON.',
    '',
    ...(work.length ? ['Pågående punkter i arbetsschemat:', ...work.map((w) => `- ${w}`), ''] : []),
    ...(asked.open.length ? ['Frågor som redan väntar på svar (ställ dem inte igen):', ...asked.open.map((q) => `- ${q}`), ''] : []),
    ...(asked.answered.length ? ['Frågor användaren nyss har svarat på (ställ dem inte igen):', ...asked.answered.map((q) => `- ${q}`), ''] : []),
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
    // A repeat of a question already open or answered lately is left out.
    if (!text || !inRange(x['message']) || x['repeats'] === true) return [];
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
        context: (Array.isArray(x['context']) ? x['context'] : []).flatMap((id): Array<[number, number]> => {
          const at = typeof id === 'string' ? /^(\d+)\.(\d+)$/.exec(id.trim()) : null;
          const m = at ? Number(at[1]) : 0;
          const b = at ? Number(at[2]) : 0;
          return at && m >= 1 && m <= blockCounts.length && b >= 1 && b <= blockCounts[m - 1]! ? [[m, b]] : [];
        }),
      },
    ];
  });
  return { questions, tags };
}

/** A message's blocks with their tags, for the transcript. */
export function taggedBlocks(blocks: string[], tags: Array<BlockTag | null>): TaggedBlock[] {
  return blocks.map((text, i) => ({ text, tag: tags[i] ?? null }));
}

const MARKER = /^\s*>?\s*\[!(?:QUESTION|NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/gim;
const WORD = /[\p{L}\p{N}]{3,}/gu;

/** The words of a text, lower-cased, for telling whether a block only repeats the question. */
function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(WORD) ?? []));
}

/**
 * A question's background as the user sees it under the question: the blocks without callout markup, and
 * without blocks that only repeat the question itself (most of their words are in it).
 */
export function questionDetail(blocks: string[], question: string): string {
  const asked = words(question);
  const kept = blocks
    .map((b) => b.replace(MARKER, '').trim())
    .filter((b) => {
      const own = [...words(b)];
      return b.length > 0 && (own.length === 0 || own.filter((w) => asked.has(w)).length / own.length < 0.6);
    });
  return [...new Set(kept)].join('\n\n');
}
