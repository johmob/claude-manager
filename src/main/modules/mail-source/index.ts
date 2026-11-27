// mail-source: the swappable mail source. This implementation drives the running classic Outlook through COM by way of a
// long-lived hidden PowerShell 5.1 child (resources/outlook-bridge.ps1) that speaks JSON lines over stdin/stdout.
// Polling is node-driven (a timer asks for items newer than a watermark); the script stays a plain read-eval-reply loop.
// Nothing from a mail is logged or put into an error message: errors are the bridge's COM text or a status phrase.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LineSplitter, encodeRequest, parseReply, toHeader, toMessage, type BridgeErrorCode } from './protocol';
import type {
  MailAccount,
  MailHeader,
  MailMessage,
  MailReplyRequest,
  MailSource,
  MailSourceState,
  MailSourceStatus,
} from './types';

export type { MailSource, MailHeader, MailMessage, MailSourceStatus, MailSourceState } from './types';

export class MailSourceError extends Error {
  constructor(readonly code: BridgeErrorCode, message: string) {
    super(message);
    this.name = 'MailSourceError';
  }
}

export interface OutlookSourceOptions {
  /** The bridge script as shipped (may sit inside the asar); it is copied to workDir before it is run. */
  scriptPath: string;
  workDir: string;
  spawn?: typeof nodeSpawn;
  now?: () => Date;
  /** Per-request timeout; sending and the first list get longer (see LONG_OPS). Default 30 s. */
  timeoutMs?: number;
  /** Restart backoff after the bridge died: first and last delay. Default 5 s and 5 min. */
  restartMinMs?: number;
  restartMaxMs?: number;
  /** How often to look again while Outlook is not running. Default 60 s. */
  notRunningRecheckMs?: number;
}

/** Ops that legitimately take longer than the default timeout. */
const LONG_OPS: Record<string, number> = { reply: 120_000, 'send-to-self': 120_000, 'list-since': 90_000 };
const SEEN_LIMIT = 2000;
const WATCH_MAX = 200;
const STDERR_LINES = 20;

interface Pending {
  id: number;
  op: string;
  args: Record<string, unknown>;
  timeoutMs: number;
  resolve: (value: unknown) => void;
  reject: (error: MailSourceError) => void;
}

export function createOutlookSource(options: OutlookSourceOptions): MailSource {
  const spawnFn = options.spawn ?? nodeSpawn;
  const now = options.now ?? (() => new Date());
  const defaultTimeout = options.timeoutMs ?? 30_000;
  const restartMin = options.restartMinMs ?? 5_000;
  const restartMax = options.restartMaxMs ?? 300_000;
  const recheckMs = options.notRunningRecheckMs ?? 60_000;

  let started = false;
  let child: ChildProcess | null = null;
  let nextId = 1;
  const queue: Pending[] = [];
  let inflight: { pending: Pending; timer: ReturnType<typeof setTimeout> } | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let recheckTimer: ReturnType<typeof setTimeout> | null = null;
  let restartDelay = restartMin;
  let stderrTail: string[] = [];
  let current: MailSourceStatus = { state: 'off', message: '', at: now().toISOString() };
  const listeners = new Set<(status: MailSourceStatus) => void>();
  const watchStops = new Set<() => void>();

  function setStatus(state: MailSourceState, message = ''): void {
    if (current.state === state && current.message === message) return;
    current = { state, message, at: now().toISOString() };
    for (const l of [...listeners]) {
      try { l(current); } catch { /* a listener's failure is its own */ }
    }
  }

  // ---------- process ----------

  function spawnChild(): void {
    if (!started || child) return;
    let script: string;
    try {
      mkdirSync(options.workDir, { recursive: true });
      script = join(options.workDir, 'outlook-bridge.ps1');
      copyFileSync(options.scriptPath, script);
    } catch (e) {
      setStatus('error', `Could not prepare the Outlook bridge: ${(e as Error).message}`);
      scheduleRestart();
      return;
    }
    setStatus('starting', '');
    stderrTail = [];
    let proc: ChildProcess;
    try {
      proc = spawnFn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ParentPid', String(process.pid)],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch (e) {
      setStatus('error', `Could not start PowerShell: ${(e as Error).message}`);
      scheduleRestart();
      return;
    }
    child = proc;
    const splitter = new LineSplitter();
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      if (child !== proc) return;
      for (const line of splitter.push(chunk)) onLine(line);
    });
    // stderr is only kept in memory (last lines) to explain a failed start; it is never written anywhere.
    let errBuf = '';
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (chunk: string) => {
      errBuf += chunk;
      const parts = errBuf.split(/\r?\n/);
      errBuf = parts.pop() ?? '';
      for (const p of parts) if (p.trim()) stderrTail.push(p.trim().slice(0, 300));
      if (stderrTail.length > STDERR_LINES) stderrTail = stderrTail.slice(-STDERR_LINES);
    });
    proc.stdin?.on('error', () => { /* the exit handler reports it */ });
    proc.on('error', (e) => onExit(proc, `PowerShell failed: ${e.message}`));
    proc.on('exit', (code) => onExit(proc, `The Outlook bridge ended (code ${code ?? '?'}).`));
    // Learn whether Outlook is there. This is also what the not-running re-check repeats.
    void probe();
  }

  function onExit(proc: ChildProcess, why: string): void {
    if (child !== proc) return;
    child = null;
    const last = stderrTail[stderrTail.length - 1];
    const text = last && started ? `${why} ${last}` : why;
    const err = new MailSourceError('failed', text);
    if (inflight) {
      clearTimeout(inflight.timer);
      const p = inflight.pending;
      inflight = null;
      p.reject(err);
    }
    // While there is no bridge nothing is answered; callers retry on their own rhythm.
    for (const p of queue.splice(0)) p.reject(err);
    if (!started) return;
    setStatus('error', text);
    scheduleRestart();
  }

  function scheduleRestart(): void {
    if (!started || restartTimer) return;
    const delay = restartDelay;
    restartDelay = Math.min(restartDelay * 2, restartMax);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      spawnChild();
    }, delay);
  }

  function killChild(): void {
    const proc = child;
    if (!proc) return;
    try { proc.kill(); } catch { /* already gone */ }
  }

  // ---------- requests ----------

  function request<T = unknown>(op: string, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!started || !child) {
        reject(new MailSourceError('failed', started ? 'The Outlook bridge is not running.' : 'The mail source is off.'));
        return;
      }
      queue.push({
        id: nextId++,
        op,
        args,
        timeoutMs: timeoutMs ?? LONG_OPS[op] ?? defaultTimeout,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      pump();
    });
  }

  function pump(): void {
    if (inflight || !child) return;
    const pending = queue.shift();
    if (!pending) return;
    const timer = setTimeout(() => {
      if (!inflight || inflight.pending !== pending) return;
      inflight = null;
      pending.reject(new MailSourceError('timeout', 'Outlook did not answer in time; restarting the bridge.'));
      // A hung bridge is replaced; the exit handler schedules the restart.
      killChild();
    }, pending.timeoutMs);
    inflight = { pending, timer };
    try {
      child.stdin?.write(encodeRequest(pending.id, pending.op, pending.args));
    } catch (e) {
      clearTimeout(timer);
      inflight = null;
      pending.reject(new MailSourceError('failed', `Could not write to the bridge: ${(e as Error).message}`));
      killChild();
    }
  }

  function onLine(line: string): void {
    const reply = parseReply(line);
    if (!reply || !inflight || reply.id !== inflight.pending.id) return;
    clearTimeout(inflight.timer);
    const { pending } = inflight;
    inflight = null;
    if (reply.ok) {
      restartDelay = restartMin;
      if (pending.op !== 'hello' && pending.op !== 'ping') setStatus('connected', '');
      pending.resolve(reply.result);
    } else {
      if (reply.code === 'not-running') noteNotRunning();
      pending.reject(new MailSourceError(reply.code, reply.error));
    }
    pump();
  }

  function noteNotRunning(): void {
    setStatus('outlook-not-running', 'Outlook (classic) is not running.');
    if (recheckTimer || !started) return;
    recheckTimer = setTimeout(() => {
      recheckTimer = null;
      void probe();
    }, recheckMs);
  }

  /** Asks the bridge whether it is attached to Outlook; sets the status from the answer. */
  async function probe(): Promise<void> {
    try {
      const res = (await request('hello')) as { attached?: boolean } | null;
      if (res && res.attached) setStatus('connected', '');
      else noteNotRunning();
    } catch {
      /* the failure already set a status (exit, timeout, not-running) */
    }
  }

  // ---------- public ----------

  const source: MailSource = {
    start() {
      if (started) return;
      started = true;
      restartDelay = restartMin;
      spawnChild();
    },

    async stop() {
      if (!started) return;
      started = false;
      for (const stop of [...watchStops]) stop();
      watchStops.clear();
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      if (recheckTimer) { clearTimeout(recheckTimer); recheckTimer = null; }
      const err = new MailSourceError('failed', 'The mail source was stopped.');
      if (inflight) {
        clearTimeout(inflight.timer);
        const p = inflight.pending;
        inflight = null;
        p.reject(err);
      }
      for (const p of queue.splice(0)) p.reject(err);
      const proc = child;
      child = null;
      if (proc) {
        await new Promise<void>((resolve) => {
          const done = (): void => { clearTimeout(t); resolve(); };
          const t = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } resolve(); }, 2000);
          proc.once('exit', done);
          try { proc.stdin?.end(); } catch { /* closed */ }
        });
      }
      setStatus('off', '');
    },

    status: () => current,

    onStatus(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    watch(opts, onItems) {
      let since = opts.since;
      const seen = new Set<string>();
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const prefix = (opts.subjectPrefix ?? '').toLowerCase();

      const tick = async (): Promise<void> => {
        timer = null;
        if (stopped) return;
        // No point asking while Outlook is known to be away; the status re-check brings us back.
        if (current.state === 'connected' || current.state === 'starting') {
          try {
            const res = (await request('list-since', {
              folder: opts.folder,
              since,
              max: WATCH_MAX,
              ...(prefix ? { subjectPrefix: opts.subjectPrefix } : {}),
            })) as { items?: unknown[] } | null;
            if (!stopped) {
              const fresh = (res?.items ?? [])
                .map((raw) => toHeader(raw, opts.folder))
                .filter((h) => h.entryId && !seen.has(h.entryId))
                .filter((h) => !prefix || h.subject.toLowerCase().startsWith(prefix))
                .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
              for (const h of fresh) {
                seen.add(h.entryId);
                if (h.at > since) since = h.at;
              }
              while (seen.size > SEEN_LIMIT) {
                const oldest = seen.values().next().value as string;
                seen.delete(oldest);
              }
              if (fresh.length > 0) {
                try { onItems(fresh); } catch { /* the consumer's failure is its own */ }
              }
            }
          } catch {
            /* status already reflects it; try again next round */
          }
        }
        if (!stopped) timer = setTimeout(() => { void tick(); }, Math.max(1000, opts.intervalMs));
      };

      timer = setTimeout(() => { void tick(); }, 0);
      const stop = (): void => {
        stopped = true;
        if (timer) { clearTimeout(timer); timer = null; }
        watchStops.delete(stop);
      };
      watchStops.add(stop);
      return stop;
    },

    async account(): Promise<MailAccount | null> {
      const r = (await request('account')) as { address?: string; displayName?: string; found?: boolean } | null;
      if (!r || !r.address) return null;
      return { address: r.address, displayName: r.displayName ?? '' };
    },

    async fetch(entryId, opts): Promise<MailMessage> {
      return toMessage(await request('get', { entryId, html: opts?.html === true }));
    },

    async conversation(entryId): Promise<MailHeader[]> {
      const r = (await request('conversation', { entryId })) as { items?: unknown[] } | null;
      return (r?.items ?? []).map((raw) => toHeader(raw));
    },

    async unreadOf(entryIds): Promise<string[]> {
      if (entryIds.length === 0) return [];
      const r = (await request('unread-of', { entryIds })) as { unread?: unknown[] } | null;
      return (r?.unread ?? []).filter((v): v is string => typeof v === 'string');
    },

    async reply(req: MailReplyRequest): Promise<void> {
      await request('reply', {
        entryId: req.entryId,
        replyAll: req.replyAll,
        html: req.html,
        attachments: req.attachments,
        token: req.token,
      });
    },

    async findSent(token, withinMinutes): Promise<MailHeader | null> {
      const r = (await request('find-sent', { token, withinMinutes })) as { item?: unknown } | null;
      return r?.item ? toHeader(r.item, 'sent') : null;
    },

    async markRead(entryId): Promise<void> {
      await request('mark-read', { entryId });
    },

    async saveAttachment(entryId, index, path): Promise<void> {
      mkdirSync(dirname(path), { recursive: true });
      await request('save-attachment', { entryId, index, path });
    },

    async sendToSelf(subject, text): Promise<void> {
      await request('send-to-self', { subject, text });
    },
  };
  return source;
}
