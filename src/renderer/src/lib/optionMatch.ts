// Matches a spoken answer to the options of a question. Pure: no DOM, no IPC.

/** Words that carry no meaning in an answer ("jag tar alternativ två" means "två"). */
const FILLER = new Set([
  'eh', 'öh', 'alltså', 'jag', 'tar', 'väljer', 'välj', 'svar', 'alternativ',
  'alternativet', 'nummer', 'punkt',
]);

const NUMBER_WORDS: Record<string, number> = {
  ett: 1, en: 1, etta: 1, ettan: 1, första: 1,
  två: 2, tvåa: 2, tvåan: 2, andra: 2,
  tre: 3, trea: 3, trean: 3, tredje: 3,
  fyra: 4, fyran: 4, fjärde: 4,
  fem: 5, femman: 5, femte: 5,
  sex: 6, sexan: 6, sjätte: 6,
  sju: 7, sjuan: 7, sjunde: 7,
  åtta: 8, åttan: 8, åttonde: 8,
  nio: 9, nian: 9, nionde: 9,
  tio: 10, tian: 10, tionde: 10,
};

/** Spoken letters that sound like a letter name. */
const LETTER_WORDS: Record<string, string> = { be: 'b', ce: 'c', de: 'd' };

const YES_CORE = new Set(['ja', 'japp', 'absolut', 'stämmer', 'korrekt', 'javisst', 'precis']);
const NO_CORE = new Set(['nej', 'nä', 'nope', 'inte']);
/** Words that may sit next to a yes or no ("ja tack", "det stämmer", "nej tack"). */
const SOFT = new Set(['det', 'är', 'tack', 'gärna', 'just']);

/** Lower case, punctuation out, filler out. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((t) => t !== '' && !FILLER.has(t));
}

interface NumberRef {
  n: number;
  letter?: string;
}

/** "2", "1b", or "1 b" starting at token i. */
function digitRef(toks: string[], i: number): NumberRef | null {
  if (/^\d+$/.test(toks[i] ?? '') && /^[a-z]$/.test(toks[i + 1] ?? '')) {
    return { n: Number(toks[i]), letter: toks[i + 1] };
  }
  const m = /^(\d+)([a-z])?$/.exec(toks[i] ?? '');
  return m ? { n: Number(m[1]), letter: m[2] } : null;
}

/** The number an option stands for: its leading digits, or a lone number word. */
function optionNumber(toks: string[]): NumberRef | null {
  if (toks.length === 1 && NUMBER_WORDS[toks[0]] !== undefined) return { n: NUMBER_WORDS[toks[0]] };
  return digitRef(toks, 0);
}

/** The letter an option stands for: a lone letter, or the letter after its number ("1b"). */
function optionLetter(toks: string[]): string | undefined {
  if (toks.length === 1 && /^[a-z]$/.test(toks[0])) return toks[0];
  return digitRef(toks, 0)?.letter;
}

function spokenLetter(toks: string[]): string | undefined {
  for (const t of toks) {
    if (/^[a-z]$/.test(t)) return t;
    if (LETTER_WORDS[t]) return LETTER_WORDS[t];
  }
  return undefined;
}

function isYes(toks: string[]): boolean {
  return toks.length > 0 && toks.every((t) => YES_CORE.has(t) || SOFT.has(t)) && toks.some((t) => YES_CORE.has(t));
}

function isNo(toks: string[]): boolean {
  return toks.length > 0 && toks.every((t) => NO_CORE.has(t) || SOFT.has(t)) && toks.some((t) => NO_CORE.has(t));
}

/** Index of the one option that matches; null when none or several match. */
function pick(matches: number[]): number | null | undefined {
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return null;
  return undefined; // no match at this step: try the next one
}

/**
 * Which option the spoken text picks, or null. Tries, in order: the exact text,
 * digits, Swedish number words, letters, yes/no and word overlap (at least 0.6 of
 * an option's words). A step that matches several options gives null.
 */
export function matchSpokenOption(spoken: string, options: string[]): number | null {
  const spokenToks = tokens(spoken);
  if (spokenToks.length === 0) return null;
  const optToks = options.map(tokens);
  const all = options.map((_, i) => i);
  const steps: (() => number[])[] = [
    // 1. exact text
    () => all.filter((i) => optToks[i].length > 0 && optToks[i].join(' ') === spokenToks.join(' ')),
    // 2. digits
    () => {
      const idx = spokenToks.findIndex((_, i) => digitRef(spokenToks, i) !== null);
      if (idx < 0) return [];
      const s = digitRef(spokenToks, idx)!;
      return all.filter((i) => {
        const o = optionNumber(optToks[i]);
        return o !== null && o.n === s.n && (s.letter === undefined || o.letter === s.letter);
      });
    },
    // 3. Swedish numbers and ordinals
    () => {
      const word = spokenToks.find((t) => NUMBER_WORDS[t] !== undefined);
      if (word === undefined) return [];
      const n = NUMBER_WORDS[word];
      return all.filter((i) => optionNumber(optToks[i])?.n === n);
    },
    // 4. letters
    () => {
      const letter = spokenLetter(spokenToks);
      if (letter === undefined) return [];
      return all.filter((i) => optionLetter(optToks[i]) === letter);
    },
    // 5. yes / no
    () => {
      if (isYes(spokenToks)) return all.filter((i) => isYes(optToks[i]));
      if (isNo(spokenToks)) return all.filter((i) => isNo(optToks[i]));
      return [];
    },
    // 6. word overlap: at least 0.6 of the option's words were said
    () => {
      const said = new Set(spokenToks);
      return all.filter((i) => {
        const o = optToks[i];
        if (o.length === 0) return false;
        const common = o.filter((t) => said.has(t)).length;
        return common / o.length >= 0.6;
      });
    },
  ];
  for (const step of steps) {
    const result = pick(step());
    if (result !== undefined) return result;
  }
  return null;
}

/** Whether the spoken text means "send the answers now". */
export function isSendCommand(spoken: string): boolean {
  return /^(klart )?skicka( svaren| det| dem)?$/.test(tokens(spoken).join(' '));
}
