/**
 * Makes a mail's HTML safe to show. The real guard is the sandboxed iframe (no scripts, no same origin)
 * and the Content-Security-Policy injected first; everything here is defence in depth, so a mistake in
 * one layer does not open the door. Regex based on purpose: no DOM is needed, so it is node-testable.
 */

/** Nothing loads from anywhere: no remote images (tracking pixels), fonts, frames or scripts. Inline style and data: images only. */
export const MAIL_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/** Light page as the mail's author saw it, also when the app is dark. The mail's own styles come after and win. */
const BASE_STYLE =
  'html{background:#fff}body{margin:0;padding:14px 16px;background:#fff;color:#1b1f27;font:14px/1.5 "Segoe UI",system-ui,sans-serif;overflow-wrap:anywhere}' +
  'img{max-width:100%;height:auto}a{color:#2456c7;cursor:default}table{max-width:100%}pre{white-space:pre-wrap}';

/** Elements removed together with everything inside them. */
const DROP_WITH_CONTENT = ['script', 'iframe', 'frameset', 'object', 'applet', 'noscript', 'template', 'audio', 'video', 'canvas'];
/** Elements whose tags are removed (a lone or closing tag too); their text stays. */
const DROP_TAGS = ['embed', 'frame', 'form', 'base', 'link', 'input', 'button', 'select', 'textarea', 'param', 'source', 'track', 'dialog'];
/** Attributes that take a URL. */
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'poster', 'data', 'srcset', 'ping'];

const TAG = /<[!?/a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*>/g;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

/** Control, space, zero-width and BOM characters: what a URL parser ignores inside a scheme. */
const CONTROL_CHARS = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(32) + String.fromCharCode(127) + '-' + String.fromCharCode(159) + String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) + String.fromCharCode(0x2028, 0x2029, 0xfeff) + ']+', 'g');
const LEADING_DOCTYPE = new RegExp('^' + "\\s" + '*' + String.fromCharCode(0xfeff) + '?' + "\\s" + '*<!doctype[^>]*>', 'i');

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

function unquote(v: string): string {
  return v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0] ? v.slice(1, -1) : v;
}

/** The value as a URL parser would see it: entities decoded, control characters and spaces gone, lower case. */
function urlForm(value: string): string {
  // eslint-disable-next-line no-control-regex
  return decodeEntities(value).replace(CONTROL_CHARS, '').toLowerCase();
}

function dangerousUrl(value: string): boolean {
  const u = urlForm(value);
  return /^(javascript|vbscript|livescript|mocha):/.test(u) || /^data:(?!image\/(png|gif|jpe?g|webp|bmp);)/.test(u);
}

/** One start tag, cleaned: event handlers, dangerous URLs, remote URLs' loading and link targets are gone. */
function cleanTag(tag: string): string {
  const m = /^<([a-zA-Z][^\s/>]*)([\s\S]*?)(\/?)>$/.exec(tag);
  if (!m) return tag;
  const name = m[1]!.toLowerCase();
  const out: string[] = [];
  for (const a of m[2]!.matchAll(ATTR)) {
    const attr = a[1]!.toLowerCase();
    const value = a[2];
    if (attr.startsWith('on')) continue;
    if (attr === 'http-equiv' && name === 'meta') return '';
    if (attr === 'style' && value && /(expression\s*\(|javascript:|@import|behaviou?r\s*:|-moz-binding)/i.test(decodeEntities(value))) continue;
    if (URL_ATTRS.includes(attr)) {
      if (!value) continue;
      if (dangerousUrl(unquote(value))) continue;
      // Links never navigate: the real address is listed under the mail and opened from there.
      if (name === 'a' && attr === 'href') {
        out.push(` data-href=${value}`);
        continue;
      }
    }
    if (attr === 'target' || attr === 'srcdoc') continue;
    out.push(value === undefined ? ` ${a[1]}` : ` ${a[1]}=${value}`);
  }
  return `<${m[1]}${out.join('')}${m[3]}>`;
}

/** Removes active content from mail HTML; the result is still the mail as written, minus anything that could act. */
export function sanitizeMailHtml(html: string): string {
  let s = html.split(String.fromCharCode(0)).join('');
  for (const el of DROP_WITH_CONTENT) {
    s = s.replace(new RegExp(`<${el}\\b[\\s\\S]*?<\\/${el}\\s*>`, 'gi'), '');
    // An element that never closes takes the rest of the document with it: safer than guessing where it ends.
    s = s.replace(new RegExp(`<${el}\\b[\\s\\S]*$`, 'gi'), '');
    s = s.replace(new RegExp(`<\\/${el}\\s*>`, 'gi'), '');
  }
  const dropNames = new Set(DROP_TAGS);
  s = s.replace(TAG, (tag) => {
    if (tag.startsWith('<!') || tag.startsWith('<?')) return tag.startsWith('<!--') || /^<!doctype/i.test(tag) ? tag : '';
    const name = /^<\/?([a-zA-Z][^\s/>]*)/.exec(tag)?.[1]?.toLowerCase();
    if (!name) return tag;
    if (dropNames.has(name)) return '';
    if (tag.startsWith('</')) return tag;
    return cleanTag(tag);
  });
  return s;
}

/** The finished document for the iframe's srcDoc: sanitised, with the CSP as the very first thing the parser meets. */
export function mailSrcdoc(html: string): string {
  const body = sanitizeMailHtml(html).replace(LEADING_DOCTYPE, '');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${MAIL_CSP}"><meta charset="utf-8"><style>${BASE_STYLE}</style>${body}`;
}

/** The same frame for a plain-text mail. */
export function textSrcdoc(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${MAIL_CSP}"><meta charset="utf-8"><style>${BASE_STYLE}</style><pre style="font:13px/1.5 Consolas,monospace;margin:0">${escaped}</pre>`;
}

export interface MailLink {
  /** The real target, as written in the mail. */
  url: string;
  /** What the link says to the reader; empty when it shows no text of its own (an image). */
  text: string;
  /** The text names another address than the link goes to: the classic phishing trick. */
  mismatch: boolean;
}

const MAX_LINKS = 50;

function allowedUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url);
}

function hostOf(url: string): string | null {
  const m = /^https?:\/\/(?:[^/@?#]*@)?([^/:?#]+)/i.exec(url);
  return m ? m[1]!.toLowerCase().replace(/^www\./, '') : null;
}

/** The text looks like an address (a domain or URL) that leads somewhere else than the link does. */
export function linkMismatch(text: string, url: string): boolean {
  const shown = /^\s*(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]\S*)?\s*$/i.exec(text);
  if (!shown) return false;
  const real = hostOf(url);
  if (!real) return false;
  const a = shown[1]!.toLowerCase().replace(/^www\./, '');
  return a !== real && !real.endsWith(`.${a}`) && !a.endsWith(`.${real}`);
}

/** Links in the HTML with their text, only http(s) and mailto, one per address, at most 50. */
export function mailLinkItems(html: string): MailLink[] {
  const seen = new Set<string>();
  const out: MailLink[] = [];
  for (const m of html.matchAll(/<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)(?:<\/a\s*>|$)/gi)) {
    const href = /(?:^|[\s"'/])href\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/i.exec(m[1]!);
    if (!href) continue;
    const url = decodeEntities(unquote(href[1]!)).trim();
    if (!allowedUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const text = decodeEntities(m[2]!.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    out.push({ url, text, mismatch: linkMismatch(text, url) });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** Just the addresses, see `mailLinkItems`. */
export function mailLinks(html: string): string[] {
  return mailLinkItems(html).map((l) => l.url);
}

/** Addresses written out in plain text. */
export function textLinks(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)) {
    seen.add(m[0].replace(/[.,;:!?]+$/, ''));
    if (seen.size >= MAX_LINKS) break;
  }
  return [...seen];
}

/** How many images point at the web (blocked, so the mail may look emptier than it is). */
export function remoteImageCount(html: string): number {
  return [...html.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*?\ssrc\s*=\s*(?:"\s*https?:|'\s*https?:|https?:)/gi)].length;
}
