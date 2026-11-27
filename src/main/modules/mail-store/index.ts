import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './schema';

/*
 * The mail store: one SQLite file with mails, threads, drafts, events, the learning log and rules.
 *
 * The types below mirror the "Mail" block of work package B (contracts.ts, task A). They are defined locally
 * so the module compiles before the contracts land; they are structurally identical, so once contracts.ts
 * has them, replace this block with `import type { ... } from '../../../shared/contracts'`.
 */

export type MailCategory = 'junk' | 'bulk' | 'info' | 'reply' | 'action' | 'meeting' | 'private';
export type MailStatus = 'new' | 'triaging' | 'triaged' | 'drafting' | 'draft_ready' | 'in_chat' | 'handled';
export type MailHandled = 'dropped' | 'replied' | 'declined' | 'done' | 'outlook';
export type MailAuthor = 'user' | 'agent' | 'agent_edited';
export type MailRuleKind = 'ignore_sender' | 'important_sender' | 'never_ai_sender' | 'never_ai_subject';
export interface MailAddress { name: string; address: string }
export interface MailAttachmentInfo { index: number; name: string; size: number; inline: boolean }
export interface MailHeader {
  entryId: string; storeId: string; internetId: string; conversationId: string;
  folder: 'inbox' | 'sent'; messageClass: string;
  from: MailAddress; to: MailAddress[]; cc: MailAddress[];
  subject: string; at: string; unread: boolean;
  attachments: MailAttachmentInfo[]; headers: Record<string, string>; sendToken: string;
}
export interface MailMessage extends MailHeader { bodyText: string; bodyHtml: string | null; truncated: boolean }
export interface MailItemView {
  id: number; threadId: string; from: MailAddress; subject: string; at: string;
  category: MailCategory | null; summary: string; reason: string; suggestedAction: string;
  needsAction: boolean; phishing: boolean; status: MailStatus; handled: MailHandled | null;
  attachmentCount: number; agent: 'working' | 'idle' | 'error' | null;
  draft: 'writing' | 'proposed' | 'failed' | null;
}
export interface MailDraftView {
  id: number; mailId: number; version: number; replyAll: boolean; body: string;
  attachments: { path: string; name: string }[];
  status: 'writing' | 'proposed' | 'sent' | 'declined' | 'superseded' | 'failed'; error: string;
}
export interface MailRule { id: number; kind: MailRuleKind; pattern: string }

const MAIL_CATEGORY_LIST: MailCategory[] = ['junk', 'bulk', 'info', 'reply', 'action', 'meeting', 'private'];
/** Categories that count in the overlay while unhandled (MAIL_ATTENTION in contracts). */
const ATTENTION: MailCategory[] = ['reply', 'action', 'private'];

export const BODY_CAP = 100_000;
const JUNK_BODY_DAYS = 30;
const HANDLED_BODY_DAYS = 365;
const STATS_DAYS = 180;
const DAY_MS = 86_400_000;

export interface TriageResult {
  category: MailCategory;
  source: 'local' | 'model' | 'user';
  summary: string;
  reason: string;
  suggestedAction: string;
  needsAction: boolean;
  phishing: boolean;
}

export interface ThreadRow {
  id: string;
  subject: string;
  claudeSessionId: string | null;
  summary: string;
  projectCwd: string | null;
  state: 'open' | 'done';
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  item: MailItemView;
  to: MailAddress[];
  cc: MailAddress[];
  bodyText: string;
  attachments: MailAttachmentInfo[];
  entryId: string;
  threadId: string;
  internetId: string;
}

export interface MailEvent { id: number; threadId: string | null; mailId: number | null; at: string; kind: string; data: unknown }

export interface LearningRow {
  mailId: number | null;
  fromAddr: string;
  category: MailCategory | null;
  suggestedAction?: string;
  choice: string;
  edit?: unknown;
}

export interface SenderStats {
  byChoice: Record<string, number>;
  byCategory: Record<string, number>;
  total: number;
}

export interface MailStore {
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  insertMail(msg: MailMessage, direction: 'in' | 'out', extra?: { authorship?: MailAuthor; sendToken?: string }): number | null;
  hasEntry(entryId: string): boolean;
  updateEntryId(oldId: string, newId: string): boolean;
  mailIdByEntry(entryId: string): number | null;
  setStatus(id: number, status: MailStatus): void;
  setTriage(id: number, triage: TriageResult): void;
  setCategory(id: number, category: MailCategory): void;
  handle(id: number, how: MailHandled): void;
  reopen(id: number): void;
  item(id: number): MailItemView | null;
  message(id: number): StoredMessage | null;
  attention(): MailItemView[];
  counts(sinceIso: string): Record<MailCategory, number>;
  recent(days: number): MailItemView[];
  triagingCount(): number;
  untriaged(): number[];
  thread(id: string): ThreadRow | null;
  threadMails(threadId: string): MailItemView[];
  setThreadSession(threadId: string, claudeSessionId: string | null): void;
  setThreadSummary(threadId: string, text: string): void;
  startDraft(mailId: number, comment: string): number;
  proposeDraft(mailId: number, draft: { body: string; replyAll: boolean; attachments: { path: string; name: string }[] }): number;
  failDraft(mailId: number, error: string): void;
  latestDraft(mailId: number): MailDraftView | null;
  draftSent(draftId: number, finalBody: string, token: string): void;
  draftDeclined(draftId: number): void;
  matchSentToken(token: string): { draftId: number; edited: boolean } | null;
  addEvent(threadId: string | null, mailId: number | null, kind: string, data?: unknown): void;
  threadEvents(threadId: string, limit: number): MailEvent[];
  addLearning(row: LearningRow): void;
  senderStats(address: string, domain: string): SenderStats;
  rules(): MailRule[];
  setRule(kind: MailRuleKind, pattern: string, on: boolean): MailRule[];
  search(query: string, limit: number): MailItemView[];
  prune(now?: Date): number;
  close(): void;
}

// ---------- pure helpers ----------

function normaliseSubject(subject: string): string {
  let s = subject.trim().toLowerCase();
  const prefix = /^(re|sv|fw|fwd|vb|aw|antw)\s*:\s*/;
  while (prefix.test(s)) s = s.replace(prefix, '');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The thread key: the Outlook ConversationID (lower-case hex) when there is one; otherwise "s-" and the first
 * 24 hex digits of sha1(normalised subject + counterpart address). The counterpart is the sender of incoming
 * mail and the first recipient of outgoing mail.
 */
export function threadKey(header: Pick<MailHeader, 'conversationId' | 'subject' | 'from' | 'to' | 'folder'>): string {
  const conv = (header.conversationId ?? '').trim().toLowerCase();
  if (conv) return conv;
  const counterpart = (header.folder === 'sent' ? header.to[0]?.address : header.from?.address) ?? '';
  const hash = createHash('sha1').update(`${normaliseSubject(header.subject ?? '')}\n${counterpart.trim().toLowerCase()}`).digest('hex');
  return 's-' + hash.slice(0, 24);
}

/** Quotes every word so FTS5 syntax characters (quotes, *, -, :, AND/OR/NOT) in user input are plain text. */
export function ftsQuery(query: string): string {
  const words = query.split(/\s+/).map((w) => w.replace(/"/g, '')).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.map((w) => `"${w}"`).join(' ');
}

function json<T>(text: unknown, fallback: T): T {
  try { return JSON.parse(String(text)) as T; } catch { return fallback; }
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

const ITEM_SELECT = `
  SELECT m.*, (SELECT d.status FROM drafts d WHERE d.mail_id = m.id AND d.status IN ('writing','proposed','failed')
               ORDER BY d.version DESC, d.id DESC LIMIT 1) AS draft_status
  FROM mails m`;

function toItem(r: Row): MailItemView {
  return {
    id: num(r.id),
    threadId: str(r.thread_id),
    from: { name: str(r.from_name), address: str(r.from_addr) },
    subject: str(r.subject),
    at: str(r.at),
    category: (r.category as MailCategory | null) ?? null,
    summary: str(r.summary),
    reason: str(r.reason),
    suggestedAction: str(r.suggested_action),
    needsAction: num(r.needs_action) === 1,
    phishing: num(r.phishing) === 1,
    status: str(r.status) as MailStatus,
    handled: (r.handled as MailHandled | null) ?? null,
    attachmentCount: json<unknown[]>(r.attachments_json, []).length,
    agent: null,
    draft: (r.draft_status as MailItemView['draft']) ?? null,
  };
}

function toDraft(r: Row): MailDraftView {
  return {
    id: num(r.id),
    mailId: num(r.mail_id),
    version: num(r.version),
    replyAll: num(r.reply_all) === 1,
    body: str(r.body),
    attachments: json<{ path: string; name: string }[]>(r.attachments_json, []),
    status: str(r.status) as MailDraftView['status'],
    error: str(r.error),
  };
}

function normaliseBody(s: string): string {
  return s.replace(/\r\n/g, '\n').trim();
}

// ---------- the store ----------

export function createMailStore(path: string, now: () => Date = () => new Date()): MailStore {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');

  const version = num((db.prepare('PRAGMA user_version').get() as Row).user_version);
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const iso = (): string => now().toISOString();
  const run = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  const get = (sql: string, ...p: (string | number | null)[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;
  const all = (sql: string, ...p: (string | number | null)[]): Row[] => db.prepare(sql).all(...p) as Row[];
  const exec = (sql: string, ...p: (string | number | null)[]): void => { db.prepare(sql).run(...p); };
  const items = (where: string, ...p: (string | number | null)[]): MailItemView[] => all(`${ITEM_SELECT} ${where}`, ...p).map(toItem);

  const mailRow = (id: number): Row | undefined => get('SELECT * FROM mails WHERE id = ?', id);
  const touchThread = (threadId: string): void => exec('UPDATE threads SET updated_at = ? WHERE id = ?', iso(), threadId);

  const latestOpenDraft = (mailId: number): Row | undefined =>
    get(`SELECT * FROM drafts WHERE mail_id = ? AND status IN ('writing','proposed','failed') ORDER BY version DESC, id DESC LIMIT 1`, mailId);

  const createDraft = (mailId: number, comment: string, status: string, fields: { body?: string; replyAll?: boolean; attachments?: unknown[]; error?: string } = {}): number => {
    const mail = mailRow(mailId);
    if (!mail) throw new Error(`No mail ${mailId}`);
    exec(`UPDATE drafts SET status = 'superseded', updated_at = ? WHERE mail_id = ? AND status IN ('writing','proposed','failed')`, iso(), mailId);
    const v = num(get('SELECT COALESCE(MAX(version), 0) AS v FROM drafts WHERE mail_id = ?', mailId)?.v) + 1;
    const t = iso();
    db.prepare(`INSERT INTO drafts (mail_id, thread_id, version, reply_all, body, attachments_json, comment, status, error, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      mailId, str(mail.thread_id), v, fields.replyAll ? 1 : 0, fields.body ?? '', JSON.stringify(fields.attachments ?? []), comment, status, fields.error ?? '', t, t);
    return num(get('SELECT last_insert_rowid() AS id')?.id);
  };

  return {
    getMeta: (key) => (get('SELECT value FROM meta WHERE key = ?', key)?.value as string | undefined) ?? null,
    setMeta: (key, value) => exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value),

    insertMail(msg, direction, extra) {
      if (get('SELECT 1 AS x FROM mails WHERE entry_id = ?', msg.entryId)) return null;
      return run(() => {
        const threadId = threadKey(msg);
        const t = iso();
        exec(`INSERT INTO threads (id, subject, created_at, updated_at) VALUES (?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at,
                subject = CASE WHEN threads.subject = '' THEN excluded.subject ELSE threads.subject END`,
          threadId, msg.subject ?? '', t, t);
        db.prepare(`INSERT INTO mails (entry_id, store_id, internet_id, thread_id, direction, message_class, from_name, from_addr,
                      to_json, cc_json, subject, at, body_text, attachments_json, headers_json, authorship, send_token, created_at, status)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          msg.entryId, msg.storeId ?? '', msg.internetId ?? '', threadId, direction, msg.messageClass || 'IPM.Note',
          msg.from?.name ?? '', (msg.from?.address ?? '').trim().toLowerCase(),
          JSON.stringify(msg.to ?? []), JSON.stringify(msg.cc ?? []), msg.subject ?? '', msg.at,
          (msg.bodyText ?? '').slice(0, BODY_CAP), JSON.stringify(msg.attachments ?? []), JSON.stringify(msg.headers ?? {}),
          direction === 'out' ? (extra?.authorship ?? 'user') : null,
          extra?.sendToken || msg.sendToken || null, t, direction === 'out' ? 'handled' : 'new');
        return num(get('SELECT last_insert_rowid() AS id')?.id);
      });
    },
    hasEntry: (entryId) => !!get('SELECT 1 AS x FROM mails WHERE entry_id = ?', entryId),
    mailIdByEntry: (entryId) => { const r = get('SELECT id FROM mails WHERE entry_id = ?', entryId); return r ? num(r.id) : null; },
    updateEntryId(oldId, newId) {
      if (oldId === newId) return false;
      if (get('SELECT 1 AS x FROM mails WHERE entry_id = ?', newId)) return false;
      const r = db.prepare('UPDATE mails SET entry_id = ? WHERE entry_id = ?').run(newId, oldId);
      return Number(r.changes) > 0;
    },

    setStatus: (id, status) => exec('UPDATE mails SET status = ? WHERE id = ?', status, id),
    setTriage(id, t) {
      exec(`UPDATE mails SET category = ?, triage_source = ?, summary = ?, reason = ?, suggested_action = ?, needs_action = ?, phishing = ?,
              status = CASE WHEN status IN ('new','triaging') THEN 'triaged' ELSE status END WHERE id = ?`,
        t.category, t.source, t.summary, t.reason, t.suggestedAction, t.needsAction ? 1 : 0, t.phishing ? 1 : 0, id);
    },
    setCategory(id, category) {
      exec(`UPDATE mails SET category = ?, triage_source = 'user',
              status = CASE WHEN status IN ('new','triaging') THEN 'triaged' ELSE status END WHERE id = ?`, category, id);
    },
    handle(id, how) {
      exec(`UPDATE mails SET status = 'handled', handled = ?, handled_at = ? WHERE id = ?`, how, iso(), id);
      const m = mailRow(id);
      if (m) touchThread(str(m.thread_id));
    },
    reopen(id) {
      exec(`UPDATE mails SET status = CASE WHEN category IS NULL THEN 'new' ELSE 'triaged' END, handled = NULL, handled_at = NULL WHERE id = ?`, id);
    },

    item(id) { const r = get(`${ITEM_SELECT} WHERE m.id = ?`, id); return r ? toItem(r) : null; },
    message(id) {
      const r = get(`${ITEM_SELECT} WHERE m.id = ?`, id);
      if (!r) return null;
      return {
        item: toItem(r),
        to: json<MailAddress[]>(r.to_json, []),
        cc: json<MailAddress[]>(r.cc_json, []),
        bodyText: str(r.body_text),
        attachments: json<MailAttachmentInfo[]>(r.attachments_json, []),
        entryId: str(r.entry_id),
        threadId: str(r.thread_id),
        internetId: str(r.internet_id),
      };
    },
    attention() {
      const marks = ATTENTION.map(() => '?').join(',');
      return items(`WHERE m.direction = 'in' AND m.status != 'handled' AND m.category IN (${marks}) ORDER BY m.at DESC, m.id DESC`, ...ATTENTION);
    },
    counts(sinceIso) {
      const out = Object.fromEntries(MAIL_CATEGORY_LIST.map((c) => [c, 0])) as Record<MailCategory, number>;
      for (const r of all(`SELECT category, COUNT(*) AS n FROM mails WHERE direction = 'in' AND status != 'handled' AND category IS NOT NULL AND at >= ? GROUP BY category`, sinceIso)) {
        if (str(r.category) in out) out[str(r.category) as MailCategory] = num(r.n);
      }
      return out;
    },
    recent(days) {
      const since = new Date(now().getTime() - days * DAY_MS).toISOString();
      return items(`WHERE m.direction = 'in' AND m.at >= ? ORDER BY m.at DESC, m.id DESC`, since);
    },
    triagingCount: () => num(get(`SELECT COUNT(*) AS n FROM mails WHERE direction = 'in' AND category IS NULL AND status IN ('new','triaging')`)?.n),
    untriaged: () => all(`SELECT id FROM mails WHERE direction = 'in' AND category IS NULL AND status IN ('new','triaging') ORDER BY at DESC`).map((r) => num(r.id)),

    thread(id) {
      const r = get('SELECT * FROM threads WHERE id = ?', id);
      if (!r) return null;
      return {
        id: str(r.id), subject: str(r.subject), claudeSessionId: (r.claude_session_id as string | null) ?? null, summary: str(r.summary),
        projectCwd: (r.project_cwd as string | null) ?? null, state: str(r.state) === 'done' ? 'done' : 'open',
        createdAt: str(r.created_at), updatedAt: str(r.updated_at),
      };
    },
    threadMails: (threadId) => items('WHERE m.thread_id = ? ORDER BY m.at ASC, m.id ASC', threadId),
    setThreadSession: (threadId, sid) => exec('UPDATE threads SET claude_session_id = ?, updated_at = ? WHERE id = ?', sid, iso(), threadId),
    setThreadSummary: (threadId, text) => exec('UPDATE threads SET summary = ?, updated_at = ? WHERE id = ?', text, iso(), threadId),

    startDraft: (mailId, comment) => run(() => createDraft(mailId, comment, 'writing')),
    proposeDraft(mailId, d) {
      return run(() => {
        const writing = get(`SELECT * FROM drafts WHERE mail_id = ? AND status = 'writing' ORDER BY version DESC, id DESC LIMIT 1`, mailId);
        if (!writing) return createDraft(mailId, '', 'proposed', d);
        exec(`UPDATE drafts SET status = 'proposed', body = ?, reply_all = ?, attachments_json = ?, error = '', updated_at = ? WHERE id = ?`,
          d.body, d.replyAll ? 1 : 0, JSON.stringify(d.attachments), iso(), num(writing.id));
        return num(writing.id);
      });
    },
    failDraft(mailId, error) {
      run(() => {
        const open = latestOpenDraft(mailId);
        if (!open) { createDraft(mailId, '', 'failed', { error }); return; }
        exec(`UPDATE drafts SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`, error, iso(), num(open.id));
      });
    },
    latestDraft(mailId) {
      const r = get(`SELECT * FROM drafts WHERE mail_id = ? AND status != 'superseded' ORDER BY version DESC, id DESC LIMIT 1`, mailId)
        ?? get('SELECT * FROM drafts WHERE mail_id = ? ORDER BY version DESC, id DESC LIMIT 1', mailId);
      return r ? toDraft(r) : null;
    },
    draftSent: (draftId, finalBody, token) =>
      exec(`UPDATE drafts SET status = 'sent', final_body = ?, send_token = ?, updated_at = ? WHERE id = ?`, finalBody, token, iso(), draftId),
    draftDeclined: (draftId) => exec(`UPDATE drafts SET status = 'declined', updated_at = ? WHERE id = ?`, iso(), draftId),
    matchSentToken(token) {
      if (!token) return null;
      const r = get(`SELECT id, body, final_body FROM drafts WHERE send_token = ? AND status = 'sent' LIMIT 1`, token);
      if (!r) return null;
      return { draftId: num(r.id), edited: normaliseBody(str(r.final_body)) !== normaliseBody(str(r.body)) };
    },

    addEvent: (threadId, mailId, kind, data) =>
      exec('INSERT INTO events (thread_id, mail_id, at, kind, data_json) VALUES (?,?,?,?,?)', threadId, mailId, iso(), kind, JSON.stringify(data ?? {})),
    threadEvents: (threadId, limit) =>
      all('SELECT * FROM events WHERE thread_id = ? ORDER BY at DESC, id DESC LIMIT ?', threadId, Math.max(1, limit)).map((r) => ({
        id: num(r.id), threadId: (r.thread_id as string | null) ?? null, mailId: r.mail_id == null ? null : num(r.mail_id),
        at: str(r.at), kind: str(r.kind), data: json<unknown>(r.data_json, {}),
      })),

    addLearning(row) {
      const addr = row.fromAddr.trim().toLowerCase();
      const domain = addr.includes('@') ? addr.slice(addr.lastIndexOf('@') + 1) : '';
      exec(`INSERT INTO learning (at, mail_id, from_addr, from_domain, category, suggested_action, choice, edit_json) VALUES (?,?,?,?,?,?,?,?)`,
        iso(), row.mailId, addr, domain, row.category, row.suggestedAction ?? '', row.choice, row.edit === undefined ? null : JSON.stringify(row.edit));
    },
    senderStats(address, domain) {
      const since = new Date(now().getTime() - STATS_DAYS * DAY_MS).toISOString();
      const rows = all('SELECT choice, category FROM learning WHERE at >= ? AND (from_addr = ? OR from_domain = ?)',
        since, address.trim().toLowerCase(), domain.trim().toLowerCase());
      const stats: SenderStats = { byChoice: {}, byCategory: {}, total: rows.length };
      for (const r of rows) {
        const choice = str(r.choice);
        stats.byChoice[choice] = (stats.byChoice[choice] ?? 0) + 1;
        if (r.category) stats.byCategory[str(r.category)] = (stats.byCategory[str(r.category)] ?? 0) + 1;
      }
      return stats;
    },

    rules: () => all('SELECT id, kind, pattern FROM rules ORDER BY id').map((r) => ({ id: num(r.id), kind: str(r.kind) as MailRuleKind, pattern: str(r.pattern) })),
    setRule(kind, pattern, on) {
      const p = pattern.trim().toLowerCase();
      if (p) {
        if (on) exec('INSERT OR IGNORE INTO rules (kind, pattern, created_at) VALUES (?,?,?)', kind, p, iso());
        else exec('DELETE FROM rules WHERE kind = ? AND pattern = ?', kind, p);
      }
      return all('SELECT id, kind, pattern FROM rules ORDER BY id').map((r) => ({ id: num(r.id), kind: str(r.kind) as MailRuleKind, pattern: str(r.pattern) }));
    },

    search(query, limit) {
      const q = ftsQuery(query);
      if (!q) return [];
      const ids = all('SELECT rowid AS id FROM mail_fts WHERE mail_fts MATCH ? ORDER BY rank LIMIT ?', q, Math.max(1, limit)).map((r) => num(r.id));
      const byId = new Map(ids.length ? items(`WHERE m.id IN (${ids.map(() => '?').join(',')})`, ...ids).map((i) => [i.id, i]) : []);
      return ids.map((id) => byId.get(id)).filter((i): i is MailItemView => !!i);
    },

    /** Clears bodies: junk and bulk after 30 days; handled mail after 365 days unless its thread has a session. */
    prune(at = now()) {
      const junkBefore = new Date(at.getTime() - JUNK_BODY_DAYS * DAY_MS).toISOString();
      const handledBefore = new Date(at.getTime() - HANDLED_BODY_DAYS * DAY_MS).toISOString();
      const a = db.prepare(`UPDATE mails SET body_text = NULL WHERE body_text IS NOT NULL AND category IN ('junk','bulk') AND at < ?`).run(junkBefore);
      const b = db.prepare(`UPDATE mails SET body_text = NULL WHERE body_text IS NOT NULL AND status = 'handled' AND at < ?
                            AND thread_id NOT IN (SELECT id FROM threads WHERE claude_session_id IS NOT NULL)`).run(handledBefore);
      return Number(a.changes) + Number(b.changes);
    },
    close: () => db.close(),
  };
}
