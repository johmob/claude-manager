// Pure helpers for mail-root (the composition of the mail feature). No I/O besides what is passed in.
import { basename, join, resolve, sep } from 'node:path';
import type { MailHeader, MailItemView } from '../shared/contracts';

/** How far back the first start looks, and how many of the unread items found there are taken in. */
export const BACKFILL_DAYS = 3;
export const BACKFILL_MAX = 50;

/**
 * Which of the items a poll reports are ingested. Items from before mail was first turned on (the backfill)
 * count only when still unread, at most `max` of the newest; everything from after that is taken, whatever
 * its read state. Oldest first, like the source reports them.
 */
export function selectIngest(headers: MailHeader[], firstEnabledAt: string, max: number = BACKFILL_MAX): MailHeader[] {
  const live = headers.filter((h) => h.at >= firstEnabledAt);
  const backfill = headers
    .filter((h) => h.at < firstEnabledAt && h.unread)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, Math.max(0, max));
  return [...backfill, ...live].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A file name that is safe to create on Windows from an attachment's name: no path parts, no reserved characters or names. */
export function sanitiseFileName(name: string, max = 120): string {
  let n = basename(name.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (!n || n === '.' || n === '..') n = 'bilaga';
  if (RESERVED.test(n)) n = `_${n}`;
  if (n.length > max) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 12 ? n.slice(dot) : '';
    n = n.slice(0, max - ext.length) + ext;
  }
  return n;
}

/** Where an attachment of a stored mail is saved: <threadDir>/attachments/<mailId>-<index>/<safe name>. */
export function attachmentPath(threadDir: string, mailId: number, index: number, name: string): string {
  return join(threadDir, 'attachments', `${mailId}-${index}`, sanitiseFileName(name));
}

/** The thread folder for a key. Keys are hex or "s-" plus hex; anything else is sanitised so it cannot leave the folder. */
export function threadDirOf(mailDir: string, threadKey: string): string {
  const safe = threadKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || '_';
  return join(mailDir, 'threads', safe);
}

/** True when `path` is `root` itself or inside it (case-insensitive, as Windows paths are). */
export function isInside(root: string, path: string): boolean {
  const r = resolve(root).toLowerCase();
  const p = resolve(path).toLowerCase();
  return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** The state a session summary has, in the terms the UI uses; null when there is no live session. */
export function agentState(status: string | undefined): MailItemView['agent'] {
  if (!status || status === 'stopped') return null;
  if (status === 'working' || status === 'starting') return 'working';
  if (status === 'error') return 'error';
  return 'idle';
}

/** Counts from the learning log as triage's hint wants them: outcomes only, one per mail (not the first click and then the send). */
export function hintStats(byChoice: Record<string, number>): { total: number; dropped: number; replied: number } {
  const n = (k: string): number => byChoice[k] ?? 0;
  const dropped = n('drop');
  const replied = n('sent') + n('sent_edited');
  const other = n('declined') + n('done') + n('read_in_outlook');
  return { total: dropped + replied + other, dropped, replied };
}

/** The first existing path of the candidates (the bundled asset, then the places the script lives in a checkout or an installed app). */
export function firstExisting(candidates: string[], exists: (path: string) => boolean): string | null {
  for (const c of candidates) {
    if (!c) continue;
    try {
      if (exists(c)) return c;
    } catch {
      /* unreadable: try the next */
    }
  }
  return null;
}

/** A short Swedish reason for a failed Outlook call, from the source's error code; the bridge's own text is never shown (it can be long and in English). */
export function sendErrorText(code: string | undefined): string {
  switch (code) {
    case 'not-running': return 'Outlook är inte igång. Starta Outlook och försök igen.';
    case 'disconnected': return 'Kontakten med Outlook bröts. Försök igen om en stund.';
    case 'not-found': return 'Mejlet finns inte kvar i Outlook (flyttat eller raderat), så svaret kan inte skickas som svar på det.';
    case 'refused': return 'Outlook vägrade skicka mejlet.';
    case 'timeout': return 'Outlook svarade inte i tid. Kontrollera i Outlook om mejlet gick iväg innan du försöker igen.';
    default: return 'Mejlet kunde inte skickas. Kontrollera Outlook och försök igen.';
  }
}

/** Trims and caps a string from the renderer. */
export function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** A positive integer id from the renderer, or null. */
export function idOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
}

/** Attachment types that can run code or active content beyond what the app's general "runnable" list covers: shown in their folder, never opened by a click. */
const RISKY_ATTACHMENT = /\.(docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam|ppsm|html?|xhtml|svg|iso|img|vhdx?|chm|appx|appxbundle|msix|dll|ocx|sys|url|website|application|gadget|library-ms|search-ms|diagcab|one)$/i;
export const isRiskyAttachment = (path: string): boolean => RISKY_ATTACHMENT.test(path);
