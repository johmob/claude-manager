/** Words that open a question asking for more than yes or no (Swedish and English). */
const OPEN_WORDS = /^(vad|vilk\w*|hur|när|var|vart|varför|vem|vems|what|which|how|when|where|why|who|whose)\b/i;
const MAX_OPTION_WORDS = 4;

/**
 * One-click answers for a question: "A eller B?" gives its options, a yes/no question gives Ja and Nej,
 * anything else none. Kept deliberately strict, so a button never puts words in the user's mouth.
 */
export function quickAnswers(question: string): string[] {
  const text = question.trim().replace(/\s+/g, ' ');
  if (!text.endsWith('?')) return [];
  const body = text.slice(0, -1);
  // "Vill du ha A eller B?" / "A, B eller C?": the options are the short pieces around "eller"/"or".
  const either = /^(?:.*?\b(?:ha|ta|köra|välja|använda|prefer|use|want)\s+)?(.+?)\s+(?:eller|or)\s+(.+)$/i.exec(body);
  if (either) {
    const options = [...either[1]!.split(/,\s*/), either[2]!].map((o) => o.trim());
    if (options.length >= 2 && options.every((o) => o && o.split(' ').length <= MAX_OPTION_WORDS)) return options;
    return [];
  }
  if (OPEN_WORDS.test(body)) return [];
  return ['Ja', 'Nej'];
}
