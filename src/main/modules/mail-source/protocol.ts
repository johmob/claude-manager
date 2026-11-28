// Pure parts of the Outlook bridge protocol: JSON lines in both directions, and defensive mapping of the
// bridge's records to the mail contract types. No mail content is ever logged from here.
import type { MailAddress, MailAttachmentInfo, MailHeader, MailMessage } from './types';

export type BridgeErrorCode = 'not-running' | 'disconnected' | 'not-found' | 'refused' | 'failed' | 'timeout';
const ERROR_CODES: readonly string[] = ['not-running', 'disconnected', 'not-found', 'refused', 'failed', 'timeout'];

export type BridgeReply =
  | { id: number | null; ok: true; result: unknown }
  | { id: number | null; ok: false; error: string; code: BridgeErrorCode };

/** One request line, newline included. */
export function encodeRequest(id: number, op: string, args: Record<string, unknown> = {}): string {
  return JSON.stringify({ id, op, args }) + '\n';
}

/** Splits a text stream into lines. Handles chunk borders and \r\n; ignores lines that are not JSON objects. */
export class LineSplitter {
  private buffer = '';
  constructor(private readonly maxBuffer = 32 * 1024 * 1024) {}

  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let at: number;
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, at).replace(/\r$/, '');
      this.buffer = this.buffer.slice(at + 1);
      if (line.startsWith('{')) out.push(line);
    }
    // A line that never ends (a runaway or non-protocol output) must not grow without bound.
    if (this.buffer.length > this.maxBuffer) this.buffer = '';
    return out;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates the shape of a reply line; null when it is not one. */
export function parseReply(line: string): BridgeReply | null {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return null; }
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') return null;
  const id = typeof raw.id === 'number' && Number.isFinite(raw.id) ? raw.id : null;
  if (raw.ok) return { id, ok: true, result: raw.result };
  const code = typeof raw.code === 'string' && ERROR_CODES.includes(raw.code) ? (raw.code as BridgeErrorCode) : 'failed';
  const error = typeof raw.error === 'string' && raw.error ? raw.error : 'The bridge reported an error.';
  return { id, ok: false, error, code };
}

const SORT_HEADERS = ['list-unsubscribe', 'list-id', 'precedence', 'auto-submitted', 'x-auto-response-suppress'];

/** Unfolds continuation lines and keeps only the headers sorting needs, under lower-case names. */
export function pickSortHeaders(rawHeaders: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!rawHeaders) return out;
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!SORT_HEADERS.includes(name) || name in out) continue;
    out[name] = line.slice(colon + 1).trim();
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function address(v: unknown): MailAddress {
  return isRecord(v) ? { name: str(v.name), address: str(v.address) } : { name: '', address: '' };
}

function addresses(v: unknown): MailAddress[] {
  return Array.isArray(v) ? v.map(address) : [];
}

function attachments(v: unknown): MailAttachmentInfo[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isRecord).map((a) => ({
    index: num(a.index),
    name: str(a.name),
    size: num(a.size),
    inline: a.inline === true,
    contentId: str(a.contentId),
  }));
}

/** Maps the bridge's record to a header; missing fields become empty. `folder` is the fallback when the record has none. */
export function toHeader(raw: unknown, folder: 'inbox' | 'sent' = 'inbox'): MailHeader {
  const r = isRecord(raw) ? raw : {};
  return {
    entryId: str(r.entryId),
    storeId: str(r.storeId),
    internetId: str(r.internetId),
    conversationId: str(r.conversationId),
    folder: r.folder === 'sent' || r.folder === 'inbox' ? r.folder : folder,
    messageClass: str(r.messageClass) || 'IPM.Note',
    from: address(r.from),
    to: addresses(r.to),
    cc: addresses(r.cc),
    subject: str(r.subject),
    at: str(r.at),
    unread: r.unread === true,
    attachments: attachments(r.attachments),
    headers: pickSortHeaders(str(r.rawHeaders)),
    sendToken: str(r.sendToken),
  };
}

export function toMessage(raw: unknown, folder: 'inbox' | 'sent' = 'inbox'): MailMessage {
  const r = isRecord(raw) ? raw : {};
  return {
    ...toHeader(raw, folder),
    bodyText: str(r.bodyText),
    bodyHtml: typeof r.bodyHtml === 'string' && r.bodyHtml ? r.bodyHtml : null,
    truncated: r.truncated === true,
  };
}
