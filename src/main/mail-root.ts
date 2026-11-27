// Composition of the mail feature: wires the Outlook source, the store, triage and the mail agent to the session
// engine, and owns the mail IPC. A sibling of index.ts and part of the composition root, so it may import modules.
// Privacy: nothing from a mail (addresses, subjects, text) is ever logged; the log only gets { channel, mailId } and
// error classes. Mail sessions' events and transcripts do not reach the app log either (index.ts routes them here).
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  AppSettings, IpcEventChannel, IpcEventMap, IpcInvokeChannel, IpcInvokeMap, MailAccount, MailAttachmentInfo, MailCategory, MailDraftView,
  MailHandled, MailHeader, MailItemView, MailMessage, MailMessageView, MailOverview, MailSource, PopupView, SessionEvent, StructuredQuery,
} from '../shared/contracts';
import { MAIL_CATEGORIES, MAIL_RULE_KINDS } from '../shared/contracts';
import { loadHistory, type SessionEngine } from './modules/session-engine';
import type { SessionModel } from './modules/session-model';
import { createOutlookSource, MailSourceError } from './modules/mail-source';
import { createMailStore, threadKey, type MailStore, type StoredMessage } from './modules/mail-store';
import { learningHint, prefilter, readTriage, triageRequest } from './modules/mail-triage';
import {
  MAIL_AGENT_PROMPT, chatOpening, createMailTools, draftPrompt, editSummary, revisePrompt, sandboxFor, textToHtml,
  type MailToolDeps, type PromptContext, type PromptMail, type ToolMail, type ToolThread,
} from './modules/mail-agent';
import {
  BACKFILL_DAYS, agentState, attachmentPath, cleanText, firstExisting, hintStats, idOf, isInside, isRiskyAttachment, selectIngest, sendErrorText, threadDirOf,
} from './mail-root-helpers';

export interface MailFeatureDeps {
  userData: string;
  settings(): AppSettings;
  engine: Pick<SessionEngine, 'start' | 'send' | 'isRunning' | 'stop'>;
  model: Pick<SessionModel, 'upsertRecord' | 'summary' | 'loadHistory' | 'transcript' | 'apply'>;
  structuredQuery: StructuredQuery;
  pushEvent<K extends IpcEventChannel>(channel: K, payload: IpcEventMap[K]): void;
  appLog: { write(kind: string, data: Record<string, unknown>): void };
  openPopup(view: PopupView): void;
  /** Places the bridge script may be found, most likely first (the bundled asset, then checkout and install layouts). */
  bridgeScriptPaths: string[];
  shell: {
    openPath(path: string): Promise<string>;
    showItemInFolder(path: string): void;
    saveCopyAs(path: string): Promise<void>;
    /** Files a click must not start (programs, scripts). */
    isRunnable(path: string): boolean;
  };
}

export interface MailFeature {
  applySettings(settings: AppSettings): void;
  stop(): Promise<void>;
  isMailSession(id: string): boolean;
  onSessionEvent(event: SessionEvent): void;
  /** Mail sessions with a running process. */
  liveCount(): number;
}

const SESSION_PREFIX = 'mail:';
const INBOX_POLL_MS = 30_000;
const SENT_POLL_MS = 120_000;
const READ_CHECK_MS = 30_000;
const MAX_LIVE = 3;
const IDLE_STOP_MS = 15 * 60_000;
const SENT_FIND_EVERY_MS = 30_000;
const SENT_FIND_TRIES = 30;
const FETCH_RETRY_MS = 60_000;
const FETCH_RETRIES = 4;
const TRIAGE_RETRY_MS = 5 * 60_000;
const PRUNE_EVERY_MS = 6 * 60 * 60_000;
const MAX_CLAMP_DAYS = 14;
const DAY_MS = 86_400_000;
const TRIAGE_FAILED = 'Kunde inte bedömas';
/** Test instances only look at mail whose subject starts like this (see CLAUDE_MANAGER_MAIL_ONLY_SUBJECT). */
const ONLY_SUBJECT = process.env['CLAUDE_MANAGER_MAIL_ONLY_SUBJECT'] || undefined;

const sessionIdOf = (key: string): string => `${SESSION_PREFIX}${key}`;
const zeroCounts = (): Record<MailCategory, number> => Object.fromEntries(MAIL_CATEGORIES.map((c) => [c, 0])) as Record<MailCategory, number>;
const addrOf = (a: string): string => a.trim().toLowerCase();
const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What triage reads of a mail; kept in memory from ingest to triage (a restart rebuilds it from the store). */
interface TriageInput {
  header: Pick<MailHeader, 'messageClass' | 'from' | 'to' | 'cc' | 'subject' | 'attachments' | 'headers'>;
  important: boolean;
}

export function createMailFeature(deps: MailFeatureDeps): MailFeature {
  const mailDir = join(deps.userData, 'mail');

  let store: MailStore | null = null;
  let source: MailSource | null = null;
  let account: MailAccount | null = null;
  /** Bumped on every enable and disable; asynchronous work of an earlier run checks it and drops out. */
  let gen = 0;
  /** A reason mail cannot run (the store would not open), shown in place of the source's status. */
  let fatal = '';
  const timers = new Set<NodeJS.Timeout>();
  const stops: Array<() => void> = [];
  let pushTimer: NodeJS.Timeout | null = null;
  let ingestChain: Promise<void> = Promise.resolve();
  const triageInputs = new Map<number, TriageInput>();
  const triageQueue: number[] = [];
  let triaging = false;
  const triageFailed = new Set<number>();
  /** Mails whose queued triage is the retry of a failed one. */
  const retryIds = new Set<number>();
  const fetchRetry: Array<{ header: MailHeader; attempts: number }> = [];
  let fetchRetryTimer: NodeJS.Timeout | null = null;
  const markRetry = new Set<string>();
  const sending = new Set<number>();
  /** The mail each thread's agent is working on now (a draft turn, or the chat the user opened). */
  const activeMail = new Map<string, number>();
  const draftTurns = new Map<string, number>();
  const live = new Map<string, { last: number; resumed: boolean; inited: boolean }>();
  const historyLoaded = new Set<string>();
  let idleTimer: NodeJS.Timeout | null = null;
  let readTimer: NodeJS.Timeout | null = null;
  let unsubStatus: (() => void) | null = null;

  const log = (kind: string, data: Record<string, unknown>): void => deps.appLog.write(kind, data);
  const logError = (where: string, e: unknown): void => log('mail-error', { where, error: e instanceof MailSourceError ? e.code : e instanceof Error ? e.name : 'unknown' });

  function later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  }

  // ---------- state push ----------

  function offStatus(): MailOverview['source'] {
    return { state: fatal ? 'error' : 'off', message: fatal, at: new Date().toISOString() };
  }

  function decorate(items: MailItemView[]): MailItemView[] {
    return items.map((i) => ({ ...i, agent: agentState(deps.model.summary(sessionIdOf(i.threadId))?.status) }));
  }

  function overview(): MailOverview {
    const enabled = deps.settings().mailEnabled;
    if (!store) return { enabled, source: offStatus(), attention: [], counts: zeroCounts(), triaging: 0 };
    return {
      enabled,
      source: fatal ? offStatus() : (source?.status() ?? offStatus()),
      attention: decorate(store.attention()),
      counts: store.counts(new Date(Date.now() - 7 * DAY_MS).toISOString()),
      triaging: store.triagingCount(),
    };
  }

  function schedulePush(): void {
    pushTimer ??= setTimeout(() => {
      pushTimer = null;
      try {
        deps.pushEvent('state:mail', overview());
      } catch (e) {
        logError('push', e);
      }
    }, 100);
  }

  function draftChanged(mailId: number): void {
    deps.pushEvent('mail:draft-changed', { mailId });
    schedulePush();
  }

  // ---------- enable / disable ----------

  function enable(): void {
    if (store) return;
    const g = ++gen;
    fatal = '';
    try {
      store = createMailStore(join(mailDir, 'mail.db'));
    } catch (e) {
      logError('store', e);
      fatal = 'Mejldatabasen kunde inte öppnas.';
      schedulePush();
      return;
    }
    const now = new Date();
    if (!store.getMeta('first_enabled_at')) {
      store.setMeta('first_enabled_at', now.toISOString());
      store.setMeta('inbox_watermark', new Date(now.getTime() - BACKFILL_DAYS * DAY_MS).toISOString());
      store.setMeta('sent_watermark', now.toISOString());
    }
    try {
      store.prune();
    } catch (e) {
      logError('prune', e);
    }
    later(function prune() {
      try { store?.prune(); } catch (e) { logError('prune', e); }
      later(prune, PRUNE_EVERY_MS);
    }, PRUNE_EVERY_MS);

    const scriptPath = firstExisting(deps.bridgeScriptPaths, existsSync) ?? deps.bridgeScriptPaths[0] ?? '';
    source = createOutlookSource({ scriptPath, workDir: mailDir });
    unsubStatus = source.onStatus((status) => {
      if (status.state === 'connected') void ensureAccount();
      schedulePush();
    });
    source.start();
    startWatches(g);
    idleTimer = setInterval(stopIdleSessions, 60_000);
    readTimer = setInterval(() => void checkReadInOutlook(g), READ_CHECK_MS);
    // Resume what was waiting for triage when the app last ran.
    for (const id of store.untriaged()) enqueueTriage(id);
    schedulePush();
  }

  async function disable(): Promise<void> {
    gen++;
    const s = source;
    const st = store;
    source = null;
    store = null;
    account = null;
    for (const stop of stops.splice(0)) stop();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (idleTimer) clearInterval(idleTimer);
    if (readTimer) clearInterval(readTimer);
    idleTimer = readTimer = null;
    if (fetchRetryTimer) clearTimeout(fetchRetryTimer);
    fetchRetryTimer = null;
    fetchRetry.length = 0;
    triageQueue.length = 0;
    triageInputs.clear();
    triageFailed.clear();
    retryIds.clear();
    markRetry.clear();
    sending.clear();
    draftTurns.clear();
    activeMail.clear();
    unsubStatus?.();
    unsubStatus = null;
    for (const key of [...live.keys()]) void deps.engine.stop(sessionIdOf(key));
    live.clear();
    if (s) await s.stop().catch((e: unknown) => logError('stop', e));
    // Wait for a triage call that is still running before the file goes away; it checks the generation when it returns.
    try { st?.close(); } catch (e) { logError('close', e); }
    schedulePush();
  }

  function startWatches(g: number): void {
    if (!store || !source) return;
    const clamp = new Date(Date.now() - MAX_CLAMP_DAYS * DAY_MS).toISOString();
    const inboxSince = [store.getMeta('inbox_watermark') ?? clamp, clamp].sort().pop()!;
    const sentSince = [store.getMeta('sent_watermark') ?? new Date().toISOString(), clamp].sort().pop()!;
    stops.push(source.watch({ folder: 'inbox', since: inboxSince, intervalMs: INBOX_POLL_MS, ...(ONLY_SUBJECT ? { subjectPrefix: ONLY_SUBJECT } : {}) }, (items) => {
      ingestChain = ingestChain.then(() => ingest(items, g)).catch((e: unknown) => logError('ingest', e));
    }));
    stops.push(source.watch({ folder: 'sent', since: sentSince, intervalMs: SENT_POLL_MS }, (items) => {
      ingestChain = ingestChain.then(() => ingestSent(items, g)).catch((e: unknown) => logError('ingest-sent', e));
    }));
  }

  async function ensureAccount(): Promise<void> {
    if (account || !source) return;
    const g = gen;
    try {
      const found = await source.account();
      if (g === gen) account = found;
    } catch (e) {
      logError('account', e);
    }
  }

  function advanceWatermark(key: 'inbox_watermark' | 'sent_watermark', items: MailHeader[]): void {
    if (!store || items.length === 0) return;
    const newest = items.reduce((m, h) => (h.at > m ? h.at : m), '');
    if (newest && newest > (store.getMeta(key) ?? '')) store.setMeta(key, newest);
  }

  // ---------- ingest ----------

  async function ingest(headers: MailHeader[], g: number): Promise<void> {
    if (!store || !source || g !== gen) return;
    await ensureAccount();
    const first = store.getMeta('first_enabled_at') ?? new Date().toISOString();
    const fresh = headers.filter((h) => !store!.hasEntry(h.entryId));
    for (const h of selectIngest(fresh, first)) {
      if (g !== gen || !store) return;
      await ingestOne(h, g);
    }
    if (g === gen) advanceWatermark('inbox_watermark', headers);
    schedulePush();
  }

  async function ingestOne(h: MailHeader, g: number, attempts = 0): Promise<void> {
    if (!store || !source || g !== gen) return;
    let msg: MailMessage;
    try {
      msg = await source.fetch(h.entryId);
    } catch (e) {
      logError('fetch', e);
      if (attempts < FETCH_RETRIES) {
        fetchRetry.push({ header: h, attempts: attempts + 1 });
        scheduleFetchRetry(g);
      }
      return;
    }
    if (g !== gen || !store) return;
    const id = store.insertMail(msg, 'in');
    if (id === null) return;
    // Already read (on the phone, say): kept for the thread's history, but nothing to sort or show.
    if (!msg.unread) {
      store.handle(id, 'outlook');
      return;
    }
    const pre = prefilter(msg, store.rules(), prefilterSelf());
    if ('ai' in pre) {
      triageInputs.set(id, { header: msg, important: pre.important });
      enqueueTriage(id);
    } else {
      store.setTriage(id, { category: pre.category, source: 'local', summary: short(msg.subject, 80), reason: pre.reason, suggestedAction: '', needsAction: false, phishing: false });
      store.addEvent(threadKey(msg), id, 'triaged', { category: pre.category, source: 'local' });
    }
    schedulePush();
  }

  function scheduleFetchRetry(g: number): void {
    if (fetchRetryTimer) return;
    fetchRetryTimer = setTimeout(() => {
      fetchRetryTimer = null;
      const batch = fetchRetry.splice(0);
      ingestChain = ingestChain
        .then(async () => {
          for (const r of batch) await ingestOne(r.header, g, r.attempts);
        })
        .catch((e: unknown) => logError('fetch-retry', e));
    }, FETCH_RETRY_MS);
  }

  /** Sent items: the app's own (found by token) and the user's own in threads the app knows. Unrelated sent mail is not stored. */
  async function ingestSent(headers: MailHeader[], g: number): Promise<void> {
    if (!store || !source || g !== gen) return;
    for (const h of headers) {
      if (g !== gen || !store || !source) return;
      if (store.hasEntry(h.entryId)) continue;
      const match = h.sendToken ? store.matchSentToken(h.sendToken) : null;
      if (!match && !store.thread(threadKey(h))) continue;
      const msg = await fetchOrHeader(h);
      if (g !== gen || !store) return;
      store.insertMail(msg, 'out', { authorship: match ? (match.edited ? 'agent_edited' : 'agent') : 'user', ...(h.sendToken ? { sendToken: h.sendToken } : {}) });
    }
    if (g === gen) advanceWatermark('sent_watermark', headers);
    schedulePush();
  }

  async function fetchOrHeader(h: MailHeader): Promise<MailMessage> {
    try {
      return await source!.fetch(h.entryId);
    } catch {
      return { ...h, bodyText: '', bodyHtml: null, truncated: false };
    }
  }

  // ---------- triage ----------

  function enqueueTriage(id: number): void {
    if (!triageQueue.includes(id)) triageQueue.push(id);
    void drainTriage();
  }

  async function drainTriage(): Promise<void> {
    if (triaging) return;
    triaging = true;
    const g = gen;
    try {
      while (g === gen && store && triageQueue.length > 0) {
        const id = triageQueue.shift()!;
        try {
          await triageOne(id, g, retryIds.delete(id));
        } catch (e) {
          logError('triage', e);
        }
        schedulePush();
      }
    } finally {
      triaging = false;
      if (triageQueue.length > 0) void drainTriage();
    }
  }

  /** Test instances only see mail the user sent to themselves, so the "from yourself" rule must not file it all away. */
  const prefilterSelf = (): MailAccount | null => (ONLY_SUBJECT ? null : account);

  function inputOf(id: number, m: StoredMessage): TriageInput {
    return triageInputs.get(id) ?? {
      header: { messageClass: m.messageClass, from: m.item.from, to: m.to, cc: m.cc, subject: m.item.subject, attachments: m.attachments, headers: m.headers },
      important: false,
    };
  }

  async function triageOne(id: number, g: number, retry: boolean): Promise<void> {
    if (!store) return;
    const m = store.message(id);
    if (!m || m.item.status === 'handled') return;
    if (retry ? !(m.item.category === 'info' && m.item.reason === TRIAGE_FAILED) : m.item.category !== null) return;
    if (!account && source?.status().state === 'connected') await ensureAccount();
    if (g !== gen || !store) return;
    store.setStatus(id, 'triaging');
    const input = inputOf(id, m);
    const pre = prefilter(input.header, store.rules(), prefilterSelf());
    if (!('ai' in pre)) {
      store.setTriage(id, { category: pre.category, source: 'local', summary: short(m.item.subject, 80), reason: pre.reason, suggestedAction: '', needsAction: false, phishing: false });
      store.addEvent(m.threadId, id, 'triaged', { category: pre.category, source: 'local' });
      triageInputs.delete(id);
      return;
    }
    const important = pre.important || input.important;
    const from = addrOf(m.item.from.address);
    const stats = store.senderStats(from, from.includes('@') ? from.slice(from.lastIndexOf('@') + 1) : '');
    const request = triageRequest({ header: input.header, bodyText: m.bodyText, self: account, important, hint: learningHint(hintStats(stats.byChoice), important), cwd: mailDir });
    mkdirSync(mailDir, { recursive: true });
    let reply: unknown = null;
    try {
      reply = await deps.structuredQuery(request);
    } catch (e) {
      logError('triage-call', e);
    }
    if (g !== gen || !store) return;
    const t = readTriage(reply);
    triageInputs.delete(id);
    if (!t) {
      store.setTriage(id, { category: 'info', source: 'local', summary: short(m.item.subject, 80), reason: TRIAGE_FAILED, suggestedAction: '', needsAction: false, phishing: false });
      store.addEvent(m.threadId, id, 'error', { where: 'triage' });
      if (!retry && !triageFailed.has(id)) {
        triageFailed.add(id);
        later(() => {
          retryIds.add(id);
          enqueueTriage(id);
        }, TRIAGE_RETRY_MS);
      }
      return;
    }
    // A sender the user marked as important is never filed as skräp or utskick.
    const category: MailCategory = important && (t.category === 'junk' || t.category === 'bulk') ? 'info' : t.category;
    store.setTriage(id, { category, source: 'model', summary: t.summary, reason: t.reason, suggestedAction: t.suggestedAction, needsAction: t.needsAction, phishing: t.phishing });
    store.addEvent(m.threadId, id, 'triaged', { category, source: 'model' });
    // Prework (off by default): the answer is ready when the user looks.
    if (deps.settings().mailPrework && category === 'reply' && t.needsAction && !t.phishing && !retry) {
      try { startDraftTurn(id, ''); } catch (e) { logError('prework', e); }
    }
  }

  // ---------- read in Outlook, mark read ----------

  async function checkReadInOutlook(g: number): Promise<void> {
    if (!store || !source || g !== gen || source.status().state !== 'connected') return;
    try {
      // Mark-as-read that could not be made earlier (Outlook was away).
      for (const entryId of [...markRetry]) {
        try {
          await source.markRead(entryId);
          markRetry.delete(entryId);
        } catch (e) {
          logError('mark-read', e);
          break;
        }
      }
      // Mail the user is working on in the app is left alone; the rest leaves the count when it is read in Outlook.
      const open = store.recent(7).filter((i) => i.status !== 'handled' && !['drafting', 'draft_ready', 'in_chat'].includes(i.status));
      const entries = open.slice(0, 200).flatMap((i) => {
        const e = store!.message(i.id)?.entryId;
        return e ? [{ item: i, entryId: e }] : [];
      });
      if (entries.length === 0) return;
      const unread = new Set(await source.unreadOf(entries.map((e) => e.entryId)));
      if (g !== gen || !store) return;
      let changed = false;
      for (const { item, entryId } of entries) {
        if (unread.has(entryId)) continue;
        const now = store.item(item.id);
        if (!now || now.status === 'handled') continue;
        learn(item.id, 'read_in_outlook');
        store.handle(item.id, 'outlook');
        changed = true;
      }
      if (changed) schedulePush();
    } catch (e) {
      logError('read-check', e);
    }
  }

  function markReadQuietly(entryId: string): void {
    if (!source) return;
    source.markRead(entryId).catch((e: unknown) => {
      logError('mark-read', e);
      markRetry.add(entryId);
    });
  }

  function learn(mailId: number, choice: string, edit?: unknown): void {
    const item = store?.item(mailId);
    if (!store || !item) return;
    store.addLearning({ mailId, fromAddr: item.from.address, category: item.category, suggestedAction: item.suggestedAction, choice, ...(edit === undefined ? {} : { edit }) });
  }

  // ---------- thread sessions ----------

  function liveKeys(): string[] {
    return [...live.keys()].filter((k) => deps.engine.isRunning(sessionIdOf(k)));
  }

  function agentWorking(key: string): boolean {
    const status = deps.model.summary(sessionIdOf(key))?.status;
    return status === 'working' || status === 'starting';
  }

  function stopIdleSessions(): void {
    const now = Date.now();
    for (const [key, s] of live) {
      if (now - s.last > IDLE_STOP_MS && !agentWorking(key) && !draftTurns.has(key)) void deps.engine.stop(sessionIdOf(key));
    }
  }

  /** A line in a thread's transcript, for problems the user should see in the chat. */
  function notice(key: string, text: string): void {
    const id = sessionIdOf(key);
    for (const entry of deps.model.apply({ type: 'notice', sessionId: id, text, level: 'warning' })) deps.pushEvent('session:transcript-upsert', { id, entry });
  }

  /** Makes sure the model knows the thread's session (hidden kind 'mail', never saved to sessions.json). */
  function ensureRecord(key: string, dir: string, resume: string | undefined): void {
    const settings = deps.settings();
    const now = new Date().toISOString();
    deps.model.upsertRecord({
      id: sessionIdOf(key), name: 'Mejl', color: '#8a6ab8', kind: 'mail', cwd: dir, model: settings.mailModel, effort: settings.mailEffort, permissionMode: 'default',
      claudeSessionId: resume, createdAt: now, archived: false, focused: false, lastActiveAt: now, contextWindow: 'auto', tokensUsed: 0, limitResetsAt: null,
    });
  }

  /** Sends a prompt to the thread's agent; starts (or resumes) the session first when it is not running. Throws when no session can start. */
  function deliver(key: string, prompt: string, contextPrefix?: () => string): void {
    if (!store) throw new Error('Mejl är inte påslaget.');
    const id = sessionIdOf(key);
    const entry = live.get(key);
    if (entry) entry.last = Date.now();
    if (deps.engine.isRunning(id)) {
      deps.engine.send(id, prompt);
      return;
    }
    const dir = threadDirOf(mailDir, key);
    mkdirSync(dir, { recursive: true });
    const resume = store.thread(key)?.claudeSessionId ?? undefined;
    ensureRecord(key, dir, resume);
    const running = liveKeys();
    if (running.length >= MAX_LIVE) {
      const idle = running.filter((k) => !agentWorking(k)).sort((a, b) => (live.get(a)?.last ?? 0) - (live.get(b)?.last ?? 0))[0];
      if (!idle) throw new Error('Tre mejlagenter arbetar redan. Vänta tills en är klar.');
      void deps.engine.stop(sessionIdOf(idle));
    }
    const settings = deps.settings();
    if (resume && !historyLoaded.has(id)) {
      historyLoaded.add(id);
      loadHistory(id, resume, dir)
        .then((events) => {
          deps.model.loadHistory(id, events);
          deps.pushEvent('session:transcript-reset', { id, entries: deps.model.transcript(id) });
        })
        .catch(() => undefined); // nothing saved: the chat starts empty
    }
    live.set(key, { last: Date.now(), resumed: !!resume, inited: false });
    deps.engine.start({
      id,
      cwd: dir,
      model: settings.mailModel,
      effort: settings.mailEffort,
      permissionMode: 'default',
      contextWindow: 'auto',
      appendSystemPrompt: MAIL_AGENT_PROMPT,
      resumeClaudeSessionId: resume,
      initialPrompt: !resume && contextPrefix ? `${contextPrefix()}\n\n${prompt}` : prompt,
      sandbox: sandboxFor(dir, createMailTools(key, toolDeps)),
    });
  }

  function promptMail(m: StoredMessage): PromptMail {
    return { from: m.item.from, to: m.to, cc: m.cc, subject: m.item.subject, at: m.item.at, bodyText: m.bodyText, attachments: m.attachments };
  }

  function promptContext(m: StoredMessage): PromptContext {
    return { userName: account?.displayName ?? '', triageSummary: m.item.summary, triageAction: m.item.suggestedAction, threadSummary: store?.thread(m.threadId)?.summary ?? '' };
  }

  /** Mail the agent may not see: excluded from Claude by the user's rule (category private). */
  const blocked = (item: MailItemView | null | undefined): boolean => !item || item.category === 'private';

  function requireStore(): MailStore {
    if (!store) throw new Error('Mejl är inte påslaget.');
    return store;
  }

  function requireAgentMail(mailId: number): StoredMessage {
    const m = requireStore().message(mailId);
    if (!m) throw new Error('Mejlet finns inte.');
    if (blocked(m.item)) throw new Error('Det här mejlet skickas inte till Claude enligt din regel.');
    return m;
  }

  /** Starts (or restarts) the draft turn for a mail: the original draft with an empty comment, a revision otherwise. */
  function startDraftTurn(mailId: number, comment: string): void {
    const s = requireStore();
    const m = requireAgentMail(mailId);
    const key = m.threadId;
    s.startDraft(mailId, comment);
    s.setStatus(mailId, 'drafting');
    s.addEvent(key, mailId, 'draft', { revise: comment !== '' });
    draftTurns.set(key, mailId);
    activeMail.set(key, mailId);
    draftChanged(mailId);
    try {
      const full = (): string => draftPrompt(promptMail(m), promptContext(m));
      deliver(key, comment ? revisePrompt(comment) : full(), comment ? full : undefined);
    } catch (e) {
      draftTurns.delete(key);
      s.failDraft(mailId, e instanceof Error ? short(e.message, 300) : 'Agenten kunde inte starta.');
      s.setStatus(mailId, 'triaged');
      logError('draft-start', e);
      draftChanged(mailId);
    }
  }

  /** The agent's turn ended (or the process died) while a draft was awaited and none came: the draft fails. */
  function failDraftTurn(key: string, why: string): void {
    const mailId = draftTurns.get(key);
    if (mailId === undefined || !store) return;
    draftTurns.delete(key);
    const d = store.latestDraft(mailId);
    if (!d || d.status !== 'writing') return;
    store.failDraft(mailId, why);
    if (store.item(mailId)?.status === 'drafting') store.setStatus(mailId, 'triaged');
    store.addEvent(key, mailId, 'error', { where: 'draft' });
    draftChanged(mailId);
  }

  function onSessionEvent(event: SessionEvent): void {
    if (!event.sessionId.startsWith(SESSION_PREFIX)) return;
    const key = event.sessionId.slice(SESSION_PREFIX.length);
    const entry = live.get(key);
    if (entry) entry.last = Date.now();
    switch (event.type) {
      case 'init':
        if (entry) entry.inited = true;
        store?.setThreadSession(key, event.claudeSessionId);
        break;
      case 'turn_finished':
        failDraftTurn(key, event.interrupted ? 'Avbröts innan utkastet blev klart.' : event.isError ? 'Agenten misslyckades med utkastet.' : 'Agenten lämnade inget utkast.');
        break;
      case 'error':
        failDraftTurn(key, short(event.message, 300) || 'Agenten kunde inte köra.');
        break;
      case 'exited':
        // A resumed conversation that never started is gone from Claude's side: the next try starts fresh.
        if (entry && entry.resumed && !entry.inited) store?.setThreadSession(key, null);
        live.delete(key);
        failDraftTurn(key, 'Agenten avslutades innan utkastet blev klart.');
        break;
    }
    schedulePush();
  }

  // ---------- the agent's tools ----------

  const toToolMail = (m: StoredMessage): ToolMail => ({
    id: m.item.id,
    direction: account && addrOf(m.item.from.address) === addrOf(account.address) ? 'out' : 'in',
    from: m.item.from,
    to: m.to,
    subject: m.item.subject,
    at: m.item.at,
    bodyText: m.bodyText,
    attachments: m.attachments,
  });

  const toolDeps: MailToolDeps = {
    async getThread(key): Promise<ToolThread> {
      const s = requireStore();
      const mails: ToolMail[] = [];
      const drafts: ToolThread['drafts'] = [];
      for (const item of s.threadMails(key)) {
        if (blocked(item)) continue;
        const m = s.message(item.id);
        if (m) mails.push(toToolMail(m));
        const d = s.latestDraft(item.id);
        if (d && d.status !== 'writing' && d.status !== 'proposed') drafts.push({ version: d.version, status: d.status, body: d.body });
      }
      return { summary: s.thread(key)?.summary ?? '', mails, drafts, events: s.threadEvents(key, 20).map((e) => ({ at: e.at, kind: e.kind })) };
    },
    async readMail(_key, mailId) {
      const m = store?.message(mailId);
      return m && !blocked(m.item) ? toToolMail(m) : null;
    },
    async search(_key, query, limit) {
      const s = requireStore();
      return s.search(query, limit + 5).filter((i) => !blocked(i)).slice(0, limit).map((i) => ({
        mailId: i.id,
        from: i.from,
        subject: i.subject,
        at: i.at,
        snippet: short((s.message(i.id)?.bodyText ?? '').replace(/\s+/g, ' ').trim(), 240),
      }));
    },
    async saveAttachment(_key, mailId, index) {
      const m = requireStore().message(mailId);
      if (!m || blocked(m.item)) throw new Error('Mejlet finns inte.');
      const path = await saveAttachmentFile(m, index);
      requireStore().addEvent(m.threadId, mailId, 'file', { index });
      return path;
    },
    async proposeReply(key, reply) {
      const s = requireStore();
      const mailId = draftTurns.get(key) ?? activeMail.get(key) ?? latestIncoming(key);
      if (mailId === null || mailId === undefined) throw new Error('Det finns inget mejl att svara på.');
      const attachments = reply.attachments
        .map((p) => p.trim())
        .filter((p) => p && existsSync(p) && statSync(p).isFile())
        .slice(0, 10)
        .map((p) => ({ path: p, name: basename(p) }));
      s.proposeDraft(mailId, { body: reply.body, replyAll: reply.replyAll, attachments });
      const status = s.item(mailId)?.status;
      if (status && status !== 'handled' && status !== 'in_chat') s.setStatus(mailId, 'draft_ready');
      s.addEvent(key, mailId, 'draft', { proposed: true });
      draftTurns.delete(key);
      draftChanged(mailId);
    },
    async note(key, summary) {
      const s = requireStore();
      s.setThreadSummary(key, summary.trim().slice(0, 2000));
      s.addEvent(key, null, 'note', {});
    },
  };

  /** The newest mail of the thread that is not the user's own. */
  function latestIncoming(key: string): number | null {
    const mine = account ? addrOf(account.address) : '';
    const items = store?.threadMails(key).filter((i) => addrOf(i.from.address) !== mine) ?? [];
    return items.length ? items[items.length - 1]!.id : null;
  }

  // ---------- attachments ----------

  async function saveAttachmentFile(m: StoredMessage, index: number): Promise<string> {
    const info: MailAttachmentInfo | undefined = m.attachments.find((a) => a.index === index);
    if (!info) throw new Error('Bilagan finns inte.');
    const path = attachmentPath(threadDirOf(mailDir, m.threadId), m.item.id, index, info.name);
    if (existsSync(path) && statSync(path).size > 0) return path;
    if (!source || source.status().state !== 'connected') throw new Error('Outlook är inte igång, så bilagan kan inte hämtas.');
    await source.saveAttachment(m.entryId, index, path);
    return path;
  }

  // ---------- sending ----------

  /** The sent copy shows up in Outlook's Sent folder a little later: find it by its token and record who wrote it. */
  function trackSent(token: string, onFound?: () => void): void {
    const g = gen;
    let tries = 0;
    const tick = (): void => {
      if (g !== gen || !store || !source) return;
      tries++;
      source.findSent(token, 15).then(
        (h) => {
          if (g !== gen || !store) return;
          if (!h) return retry();
          onFound?.();
          if (store.hasEntry(h.entryId)) return;
          const match = store.matchSentToken(token);
          void fetchOrHeader(h).then((msg) => {
            if (g !== gen || !store) return;
            store.insertMail(msg, 'out', { authorship: match?.edited ? 'agent_edited' : 'agent', sendToken: token });
            schedulePush();
          });
        },
        (e: unknown) => { logError('find-sent', e); retry(); },
      );
    };
    const retry = (): void => {
      if (tries < SENT_FIND_TRIES) later(tick, SENT_FIND_EVERY_MS);
    };
    later(tick, 10_000);
  }

  /** Everything that follows a send that went through. */
  function finishSent(mailId: number, draft: MailDraftView, body: string, token: string, attachmentCount: number): void {
    const s = store;
    if (!s) return;
    const m = s.message(mailId);
    s.draftSent(draft.id, body, token);
    const edit = editSummary(draft.body, body);
    learn(mailId, edit.changed ? 'sent_edited' : 'sent', edit.changed ? edit : undefined);
    s.handle(mailId, 'replied');
    if (m) {
      s.addEvent(m.threadId, mailId, 'sent', { replyAll: draft.replyAll, attachments: attachmentCount, edited: edit.changed });
      markReadQuietly(m.entryId);
    }
    draftChanged(mailId);
  }

  async function sendDraft(req: IpcInvokeMap['mail:draft-send']['req']): Promise<{ ok: boolean; error: string }> {
    const s = requireStore();
    const m = s.message(req.mailId);
    const draft = s.latestDraft(req.mailId);
    if (!m || !draft || draft.id !== req.draftId || draft.status !== 'proposed') return { ok: false, error: 'Utkastet finns inte längre eller är redan hanterat.' };
    const body = cleanText(req.body, 50_000);
    if (!body) return { ok: false, error: 'Svaret är tomt.' };
    if (!source) return { ok: false, error: sendErrorText('not-running') };
    if (sending.has(req.mailId)) return { ok: false, error: 'Svaret skickas redan.' };
    // Only files the agent proposed can be attached; the user ticks them.
    const proposed = new Set(draft.attachments.map((a) => a.path.toLowerCase()));
    const attachments = (Array.isArray(req.attachments) ? req.attachments : []).filter((p): p is string => typeof p === 'string' && proposed.has(p.toLowerCase()));
    const missing = attachments.find((p) => !existsSync(p));
    if (missing) return { ok: false, error: `Bilagan finns inte: ${basename(missing)}` };
    const replyAll = req.replyAll === true;
    const token = randomUUID();
    const g = gen;
    sending.add(req.mailId);
    try {
      await source.reply({ entryId: m.entryId, replyAll, html: textToHtml(body), attachments, token });
    } catch (e) {
      logError('send', e);
      const code = e instanceof MailSourceError ? e.code : undefined;
      // A timeout may still have sent it: look for the sent copy for a while, and finish the draft if it shows up.
      if (code === 'timeout') {
        trackSent(token, () => {
          if (store && g === gen && store.latestDraft(req.mailId)?.status === 'proposed') finishSent(req.mailId, draft, body, token, attachments.length);
        });
      }
      return { ok: false, error: sendErrorText(code) };
    } finally {
      sending.delete(req.mailId);
    }
    try {
      if (g === gen && store) finishSent(req.mailId, draft, body, token, attachments.length);
      trackSent(token);
    } catch (e) {
      logError('send-after', e);
    }
    return { ok: true, error: '' };
  }

  // ---------- user actions ----------

  /** The user acted on a mail: it is handled, and only now marked read in Outlook. */
  function resolveMail(mailId: number, how: Exclude<MailHandled, 'outlook'>, choice: string): void {
    const s = requireStore();
    const m = s.message(mailId);
    if (!m) throw new Error('Mejlet finns inte.');
    learn(mailId, choice);
    s.handle(mailId, how);
    s.addEvent(m.threadId, mailId, how === 'dropped' ? 'dropped' : how === 'declined' ? 'declined' : 'done', {});
    markReadQuietly(m.entryId);
  }

  function actOn(mailId: number, action: IpcInvokeMap['mail:act']['req']['action']): void {
    const s = requireStore();
    switch (action) {
      case 'drop':
        resolveMail(mailId, 'dropped', 'drop');
        break;
      case 'done':
        resolveMail(mailId, 'done', 'done');
        break;
      case 'reopen':
        if (!s.item(mailId)) throw new Error('Mejlet finns inte.');
        s.reopen(mailId);
        break;
      case 'reply': {
        const m = requireAgentMail(mailId);
        learn(mailId, 'reply');
        deps.openPopup({ kind: 'mail', id: String(mailId), mode: 'draft' });
        const d = s.latestDraft(mailId);
        // A draft that is being written or waits for the user is shown as it is; otherwise a new one is started.
        if (!d || d.status === 'failed' || d.status === 'sent' || d.status === 'declined' || d.status === 'superseded') startDraftTurn(mailId, '');
        else activeMail.set(m.threadId, mailId);
        break;
      }
      case 'agent': {
        const m = requireAgentMail(mailId);
        learn(mailId, 'agent');
        if (m.item.status !== 'handled') s.setStatus(mailId, 'in_chat');
        activeMail.set(m.threadId, mailId);
        s.addEvent(m.threadId, mailId, 'note', { chat: true });
        deps.openPopup({ kind: 'mail', id: String(mailId), mode: 'chat' });
        try {
          deliver(m.threadId, chatOpening(promptMail(m), promptContext(m)));
        } catch (e) {
          logError('chat-start', e);
          notice(m.threadId, e instanceof Error ? e.message : 'Agenten kunde inte starta.');
          throw e;
        }
        break;
      }
    }
    schedulePush();
  }

  // ---------- IPC ----------

  /** Channels that change something; reads (overview, list, message, draft, rules) are too frequent to log. */
  const LOGGED = new Set<string>(['mail:act', 'mail:draft-revise', 'mail:draft-send', 'mail:draft-decline', 'mail:chat', 'mail:reclassify', 'mail:set-rule', 'mail:attachment', 'mail:reconnect']);

  function reg<K extends IpcInvokeChannel>(channel: K, fn: (req: IpcInvokeMap[K]['req']) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>): void {
    ipcMain.handle(channel, (_event, req: IpcInvokeMap[K]['req']) => {
      if (LOGGED.has(channel)) {
        const raw = (typeof req === 'object' && req !== null ? (req as Record<string, unknown>)['mailId'] : undefined);
        log('mail', { channel, mailId: typeof raw === 'number' ? raw : null });
      }
      return fn(req);
    });
  }

  const reqOf = (req: unknown): Record<string, unknown> => (typeof req === 'object' && req !== null ? (req as Record<string, unknown>) : {});
  const mailIdOf = (req: unknown): number => {
    const id = idOf(reqOf(req)['mailId']);
    if (id === null) throw new Error('Ogiltigt mejl-id.');
    return id;
  };

  reg('mail:overview', () => overview());
  reg('mail:list', (req) => {
    const raw = reqOf(req)['days'];
    const days = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 7;
    return store ? decorate(store.recent(days).slice(0, 1000)) : [];
  });
  reg('mail:message', async (req): Promise<MailMessageView | null> => {
    const mailId = mailIdOf(req);
    const m = store?.message(mailId);
    if (!store || !m) return null;
    let bodyHtml: string | null = null;
    let bodyText = m.bodyText;
    if (reqOf(req)['html'] === true && source && source.status().state === 'connected') {
      try {
        const full = await source.fetch(m.entryId, { html: true });
        bodyHtml = full.bodyHtml;
        if (!bodyText) bodyText = full.bodyText;
      } catch (e) {
        logError('message-html', e);
      }
    }
    return {
      item: decorate([m.item])[0]!,
      to: m.to,
      cc: m.cc,
      bodyText,
      bodyHtml,
      attachments: m.attachments,
      thread: store ? decorate(store.threadMails(m.threadId)) : [],
      sessionId: sessionIdOf(m.threadId),
    };
  });
  reg('mail:act', (req) => {
    const action = reqOf(req)['action'];
    if (action !== 'drop' && action !== 'reply' && action !== 'agent' && action !== 'done' && action !== 'reopen') throw new Error('Okänd åtgärd.');
    actOn(mailIdOf(req), action);
  });
  reg('mail:draft', (req) => store?.latestDraft(mailIdOf(req)) ?? null);
  reg('mail:draft-revise', (req) => {
    const comment = cleanText(reqOf(req)['comment'], 4000);
    if (!comment) throw new Error('Kommentaren är tom.');
    startDraftTurn(mailIdOf(req), comment);
  });
  reg('mail:draft-send', (req) => {
    const r = reqOf(req);
    const draftId = idOf(r['draftId']);
    if (draftId === null) throw new Error('Ogiltigt utkast.');
    return sendDraft({
      mailId: mailIdOf(req),
      draftId,
      body: typeof r['body'] === 'string' ? r['body'] : '',
      replyAll: r['replyAll'] === true,
      attachments: Array.isArray(r['attachments']) ? (r['attachments'] as unknown[]).filter((p): p is string => typeof p === 'string') : [],
    });
  });
  reg('mail:draft-decline', (req) => {
    const s = requireStore();
    const mailId = mailIdOf(req);
    const draftId = idOf(reqOf(req)['draftId']);
    const d = s.latestDraft(mailId);
    if (draftId !== null && d && d.id === draftId && d.status !== 'sent') s.draftDeclined(draftId);
    resolveMail(mailId, 'declined', 'declined');
    draftChanged(mailId);
  });
  reg('mail:chat', (req) => {
    const text = cleanText(reqOf(req)['text'], 20_000);
    if (!text) return;
    const mailId = mailIdOf(req);
    const m = requireAgentMail(mailId);
    activeMail.set(m.threadId, mailId);
    if (m.item.status !== 'handled' && m.item.status !== 'draft_ready') store?.setStatus(mailId, 'in_chat');
    deliver(m.threadId, text, () => chatOpening(promptMail(m), promptContext(m)));
    schedulePush();
  });
  reg('mail:reclassify', (req) => {
    const s = requireStore();
    const mailId = mailIdOf(req);
    const category = reqOf(req)['category'];
    if (typeof category !== 'string' || !(MAIL_CATEGORIES as readonly string[]).includes(category)) throw new Error('Okänd kategori.');
    const item = s.item(mailId);
    if (!item) throw new Error('Mejlet finns inte.');
    learn(mailId, `reclassified:${category}`);
    s.setCategory(mailId, category as MailCategory);
    s.addEvent(item.threadId, mailId, 'reclassified', { from: item.category, to: category });
    schedulePush();
  });
  reg('mail:rules', () => store?.rules() ?? []);
  reg('mail:set-rule', (req) => {
    const s = requireStore();
    const r = reqOf(req);
    const kind = r['kind'];
    const pattern = cleanText(r['pattern'], 200);
    if (typeof kind !== 'string' || !(MAIL_RULE_KINDS as readonly string[]).includes(kind) || !pattern) throw new Error('Ogiltig regel.');
    const rules = s.setRule(kind as (typeof MAIL_RULE_KINDS)[number], pattern, r['on'] === true);
    schedulePush();
    return rules;
  });
  reg('mail:attachment', async (req) => {
    const s = requireStore();
    const mailId = mailIdOf(req);
    const r = reqOf(req);
    const action = r['action'];
    const index = r['index'];
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1) throw new Error('Ogiltig bilaga.');
    if (action !== 'open' && action !== 'save-as' && action !== 'show') throw new Error('Okänd åtgärd.');
    const m = s.message(mailId);
    if (!m) throw new Error('Mejlet finns inte.');
    const path = await saveAttachmentFile(m, index);
    if (!isInside(mailDir, path)) throw new Error('Ogiltig sökväg.');
    if (action === 'show' || (action === 'open' && (deps.shell.isRunnable(path) || isRiskyAttachment(path)))) return deps.shell.showItemInFolder(path);
    if (action === 'save-as') return deps.shell.saveCopyAs(path);
    const failed = await deps.shell.openPath(path);
    if (failed) throw new Error(failed);
  });
  reg('mail:reconnect', async () => {
    if (!store || !source) return;
    const g = gen;
    for (const stop of stops.splice(0)) stop();
    await source.stop();
    if (g !== gen || !store || !source) return;
    source.start();
    startWatches(g);
    schedulePush();
  });

  return {
    applySettings(settings) {
      if (settings.mailEnabled && !store) enable();
      else if (!settings.mailEnabled && (store || source)) void disable();
      else schedulePush();
    },
    stop: () => disable(),
    isMailSession: (id) => id.startsWith(SESSION_PREFIX),
    onSessionEvent,
    liveCount: () => liveKeys().length,
  };
}
