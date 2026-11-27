// Pure text helpers for mail triage: quote stripping, cleaning, and wrapping mail as data.

const SEPARATORS: RegExp[] = [
  /^\s*-{2,}\s*(original message|ursprungligt meddelande|ursprungligt mejl|weitergeleitete nachricht)\s*-{2,}\s*$/i,
  /^\s*_{5,}\s*$/,
  /^\s*(from|från|von|de)\s*:\s*\S.*$/i,
  /^\s*on\b.{3,200}\bwrote:\s*$/i,
  /^\s*den\b.{3,200}\bskrev\b.{0,200}:\s*$/i,
];

/** The new text of a mail: drops `>` lines and everything after a reply separator or quoted header block. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SEPARATORS.some((re) => re.test(line))) {
      // "From:" alone could be ordinary text; treat it as a header block only when a Sent/Subject-like line follows.
      if (/^\s*(from|från|von|de)\s*:/i.test(line)) {
        const next = lines.slice(i + 1, i + 6).join('\n');
        if (!/^\s*(sent|skickat|skickad|date|datum|to|till|subject|ämne|cc)\s*:/im.test(next)) {
          out.push(line);
          continue;
        }
      }
      break;
    }
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

/** Collapses whitespace runs (keeping paragraph breaks) and cuts to `max` characters. */
export function cleanBody(text: string, max: number): string {
  const t = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > max ? `${t.slice(0, Math.max(0, max - 1))}…` : t;
}

/** Defuses any mail-data tag inside content so a mail cannot close the data block early. */
function neutralise(s: string): string {
  return s.replace(/<(\s*\/?\s*)mail-data/gi, '<​$1mail-data');
}

/** The `<mail-data>` block: labelled fields, content neutralised. Nothing inside is an instruction. */
export function wrapMailData(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `${neutralise(k).replace(/[\r\n:]/g, ' ')}: ${neutralise(v)}`)
    .join('\n');
  return `<mail-data>\n${body}\n</mail-data>`;
}
