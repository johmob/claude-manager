import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutlookSource, MailSourceError } from './index';
import type { MailHeader, MailSource, MailSourceStatus } from './types';

interface Req { id: number; op: string; args: Record<string, unknown> }

/** A stand-in for the PowerShell child: captures the request lines, lets the test answer them. */
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  requests: Req[] = [];
  killed = false;
  onRequest: ((req: Req) => void) | null = null;
  private buf = '';
  constructor() {
    super();
    // Like the real process: closing stdin ends it.
    this.stdin.on('end', () => this.emit('exit', 0));
    this.stdin.on('data', (d: Buffer) => {
      this.buf += d.toString('utf8');
      let at: number;
      while ((at = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, at);
        this.buf = this.buf.slice(at + 1);
        const req = JSON.parse(line) as Req;
        this.requests.push(req);
        this.onRequest?.(req);
      }
    });
  }
  ok(id: number, result: unknown): void { this.stdout.write(JSON.stringify({ id, ok: true, result }) + '\n'); }
  fail(id: number, error: string, code: string): void { this.stdout.write(JSON.stringify({ id, ok: false, error, code }) + '\n'); }
  kill(): boolean { this.killed = true; this.emit('exit', null); return true; }
  die(code = 1): void { this.emit('exit', code); }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0); };

function header(entryId: string, at: string, subject = 'Test', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { entryId, at, subject, folder: 'inbox', from: { name: 'Anna Exempel', address: 'anna@example.com' }, ...extra };
}

describe('createOutlookSource', () => {
  let dir: string;
  let children: FakeChild[];
  let source: MailSource;
  /** Default behaviour of a new child: Outlook is there. */
  let attached: boolean;
  let answerHello: boolean;
  let responder: (child: FakeChild, req: Req) => void;

  const spawn = vi.fn(() => {
    const c = new FakeChild();
    c.onRequest = (req) => {
      if (req.op === 'hello') { if (answerHello) c.ok(req.id, { languageMode: 'FullLanguage', psVersion: '5.1', outlookVersion: '16', attached }); }
      else responder(c, req);
    };
    children.push(c);
    return c;
  });

  function make(extra: Record<string, unknown> = {}): MailSource {
    source = createOutlookSource({
      scriptPath: join(dir, 'src.ps1'),
      workDir: join(dir, 'work'),
      spawn: spawn as never,
      timeoutMs: 1000,
      ...extra,
    });
    return source;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'cm-mail-source-'));
    writeFileSync(join(dir, 'src.ps1'), '# fake');
    children = [];
    attached = true;
    answerHello = true;
    responder = () => {};
    spawn.mockClear();
  });

  afterEach(async () => {
    const stopping = source?.stop();
    await vi.advanceTimersByTimeAsync(2500);
    await stopping;
    vi.useRealTimers();
  });

  it('spawns a hidden PowerShell on a copy of the script and reports connected after hello', async () => {
    make();
    const seen: MailSourceStatus[] = [];
    source.onStatus((s) => seen.push(s));
    source.start();
    await flush();
    expect(spawn).toHaveBeenCalledTimes(1);
    const [exe, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], { windowsHide: boolean }];
    expect(exe).toBe('powershell.exe');
    expect(args).toContain('-File');
    expect(args[args.indexOf('-File') + 1]).toBe(join(dir, 'work', 'outlook-bridge.ps1'));
    expect(args[args.indexOf('-ParentPid') + 1]).toBe(String(process.pid));
    expect(opts.windowsHide).toBe(true);
    expect(source.status().state).toBe('connected');
    expect(seen.map((s) => s.state)).toEqual(['starting', 'connected']);
  });

  it('correlates answers to requests and keeps one request in flight', async () => {
    make();
    source.start();
    await flush();
    const child = children[0];
    const a = source.unreadOf(['x', 'y']);
    const b = source.conversation('x');
    await flush();
    // Only the first is written until it is answered.
    const ops = child.requests.filter((r) => r.op !== 'hello');
    expect(ops.map((r) => r.op)).toEqual(['unread-of']);
    child.ok(ops[0].id, { unread: ['y'] });
    await flush();
    expect(await a).toEqual(['y']);
    const ops2 = child.requests.filter((r) => r.op !== 'hello');
    expect(ops2.map((r) => r.op)).toEqual(['unread-of', 'conversation']);
    child.ok(ops2[1].id, { items: [header('c1', '2026-01-01T00:00:00Z')] });
    const items = await b;
    expect(items).toHaveLength(1);
    expect(items[0].entryId).toBe('c1');
  });

  it('copes with replies split across chunks and noise lines', async () => {
    make();
    source.start();
    await flush();
    const child = children[0];
    responder = (c, req) => {
      const text = JSON.stringify({ id: req.id, ok: true, result: { unread: ['z'] } }) + '\r\n';
      c.stdout.write('WARNING: noise\n' + text.slice(0, 10));
      c.stdout.write(text.slice(10));
    };
    const p = source.unreadOf(['z']);
    await flush();
    expect(await p).toEqual(['z']);
    expect(child.killed).toBe(false);
  });

  it('maps a fetched message and passes the html flag', async () => {
    make();
    source.start();
    await flush();
    responder = (c, req) => c.ok(req.id, { ...header('m1', '2026-01-01T00:00:00Z'), bodyText: 'Hej', bodyHtml: null, truncated: false, rawHeaders: 'Precedence: bulk' });
    const p = source.fetch('m1', { html: true });
    await flush();
    const m = await p;
    expect(m.bodyText).toBe('Hej');
    expect(m.headers).toEqual({ precedence: 'bulk' });
    expect(children[0].requests.at(-1)).toMatchObject({ op: 'get', args: { entryId: 'm1', html: true } });
  });

  it('turns a bridge error into a MailSourceError with its code', async () => {
    make();
    source.start();
    await flush();
    responder = (c, req) => c.fail(req.id, 'The item was not found.', 'not-found');
    const p = source.markRead('nope');
    p.catch(() => {});
    await flush();
    await expect(p).rejects.toMatchObject({ name: 'MailSourceError', code: 'not-found' });
    expect(source.status().state).toBe('connected');
  });

  it('kills and restarts a bridge that does not answer', async () => {
    make({ restartMinMs: 5000 });
    source.start();
    await flush();
    responder = () => {}; // never answers
    const p = source.findSent('tok', 10);
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(children[0].killed).toBe(true);
    expect(source.status().state).toBe('error');
    expect(spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(spawn).toHaveBeenCalledTimes(2);
    await flush();
    expect(source.status().state).toBe('connected');
  });

  it('restarts after an exit with a growing backoff', async () => {
    make({ restartMinMs: 5000, restartMaxMs: 20000 });
    source.start();
    await flush();
    children[0].die(1);
    await flush();
    expect(source.status().state).toBe('error');
    await vi.advanceTimersByTimeAsync(4999);
    expect(spawn).toHaveBeenCalledTimes(1);
    answerHello = false;
    await vi.advanceTimersByTimeAsync(1);
    expect(spawn).toHaveBeenCalledTimes(2);
    // Dies again before it ever answered: the delay doubles.
    children[1].die(1);
    await flush();
    await vi.advanceTimersByTimeAsync(9999);
    expect(spawn).toHaveBeenCalledTimes(2);
    answerHello = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(spawn).toHaveBeenCalledTimes(3);
    await flush();
    // A good answer resets the delay.
    expect(source.status().state).toBe('connected');
    children[2].die(1);
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(spawn).toHaveBeenCalledTimes(4);
  });

  it('rejects requests while the bridge is down instead of queueing them', async () => {
    make();
    source.start();
    await flush();
    children[0].die(1);
    await flush();
    await expect(source.unreadOf(['a'])).rejects.toBeInstanceOf(MailSourceError);
  });

  it('reports outlook-not-running and re-checks every minute', async () => {
    attached = false;
    make({ notRunningRecheckMs: 60_000 });
    source.start();
    await flush();
    expect(source.status().state).toBe('outlook-not-running');
    expect(children[0].requests.filter((r) => r.op === 'hello')).toHaveLength(1);
    attached = true;
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(children[0].requests.filter((r) => r.op === 'hello')).toHaveLength(2);
    expect(source.status().state).toBe('connected');
  });

  it('flips to outlook-not-running when an op answers not-running', async () => {
    make();
    source.start();
    await flush();
    responder = (c, req) => c.fail(req.id, 'Outlook is not running.', 'not-running');
    const p = source.account();
    p.catch(() => {});
    await flush();
    await expect(p).rejects.toMatchObject({ code: 'not-running' });
    expect(source.status().state).toBe('outlook-not-running');
  });

  it('returns null for an unknown account and the account when found', async () => {
    make();
    source.start();
    await flush();
    responder = (c, req) => c.ok(req.id, { address: '', displayName: '', found: false });
    const a = source.account();
    await flush();
    expect(await a).toBeNull();
    responder = (c, req) => c.ok(req.id, { address: 'anna@example.com', displayName: 'Anna Exempel', found: true });
    const b = source.account();
    await flush();
    expect(await b).toEqual({ address: 'anna@example.com', displayName: 'Anna Exempel' });
  });

  describe('watch', () => {
    it('reports each item once, oldest first, and moves the watermark', async () => {
      make();
      source.start();
      await flush();
      const polls: Record<string, unknown>[] = [];
      let round = 0;
      responder = (c, req) => {
        polls.push(req.args);
        round++;
        if (round === 1) c.ok(req.id, { items: [header('b', '2026-01-01T10:00:02Z'), header('a', '2026-01-01T10:00:01Z')] });
        // The same item at the boundary comes back, plus one new.
        else if (round === 2) c.ok(req.id, { items: [header('c', '2026-01-01T10:00:05Z'), header('b', '2026-01-01T10:00:02Z')] });
        else c.ok(req.id, { items: [] });
      };
      const batches: MailHeader[][] = [];
      source.watch({ folder: 'inbox', since: '2026-01-01T10:00:00Z', intervalMs: 30_000 }, (items) => batches.push(items));
      await flush();
      expect(batches.map((b) => b.map((h) => h.entryId))).toEqual([['a', 'b']]);
      await vi.advanceTimersByTimeAsync(30_000);
      await flush();
      expect(batches.map((b) => b.map((h) => h.entryId))).toEqual([['a', 'b'], ['c']]);
      await vi.advanceTimersByTimeAsync(30_000);
      await flush();
      expect(batches).toHaveLength(2);
      expect(polls[0]).toMatchObject({ folder: 'inbox', since: '2026-01-01T10:00:00Z' });
      expect(polls[1]).toMatchObject({ since: '2026-01-01T10:00:02Z' });
      expect(polls[2]).toMatchObject({ since: '2026-01-01T10:00:05Z' });
    });

    it('filters by subject prefix before reporting', async () => {
      make();
      source.start();
      await flush();
      responder = (c, req) => c.ok(req.id, { items: [
        header('1', '2026-01-01T10:00:01Z', 'Claude Manager test abc'),
        header('2', '2026-01-01T10:00:02Z', 'Something else'),
        header('3', '2026-01-01T10:00:03Z', 'RE: Claude Manager test abc'),
      ] });
      const got: string[] = [];
      source.watch({ folder: 'inbox', since: '2026-01-01T00:00:00Z', intervalMs: 30_000, subjectPrefix: 'claude manager test' }, (items) => got.push(...items.map((h) => h.entryId)));
      await flush();
      expect(got).toEqual(['1']);
      expect(children[0].requests.at(-1)?.args).toMatchObject({ subjectPrefix: 'claude manager test' });
    });

    it('does not poll while Outlook is away, and picks up again afterwards', async () => {
      attached = false;
      make({ notRunningRecheckMs: 60_000 });
      source.start();
      await flush();
      let polls = 0;
      responder = (c, req) => { polls++; c.ok(req.id, { items: [] }); };
      const stop = source.watch({ folder: 'inbox', since: '2026-01-01T00:00:00Z', intervalMs: 30_000 }, () => {});
      await vi.advanceTimersByTimeAsync(30_000);
      expect(polls).toBe(0);
      attached = true;
      await vi.advanceTimersByTimeAsync(30_000); // 60 s: the hello re-check connects
      await flush();
      await vi.advanceTimersByTimeAsync(30_000);
      await flush();
      expect(polls).toBeGreaterThan(0);
      stop();
    });

    it('survives a failing poll and stops when asked', async () => {
      make();
      source.start();
      await flush();
      let polls = 0;
      responder = (c, req) => { polls++; c.fail(req.id, 'boom', 'failed'); };
      const stop = source.watch({ folder: 'sent', since: '2026-01-01T00:00:00Z', intervalMs: 30_000 }, () => {});
      await flush();
      expect(polls).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);
      await flush();
      expect(polls).toBe(2);
      stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(polls).toBe(2);
    });

    it('keeps the seen set bounded', async () => {
      make();
      source.start();
      await flush();
      let round = 0;
      responder = (c, req) => {
        round++;
        const items = Array.from({ length: 150 }, (_, i) => header(`r${round}-${i}`, `2026-01-01T00:${String(round).padStart(2, '0')}:00Z`));
        c.ok(req.id, { items });
      };
      let total = 0;
      source.watch({ folder: 'inbox', since: '2025-12-31T00:00:00Z', intervalMs: 1000 }, (items) => { total += items.length; });
      for (let i = 0; i < 20; i++) { await vi.advanceTimersByTimeAsync(1000); await flush(); }
      expect(total).toBeGreaterThan(2000);
    });
  });

  it('sends a reply with its token and attachments', async () => {
    make();
    source.start();
    await flush();
    responder = (c, req) => c.ok(req.id, { sent: true });
    const p = source.reply({ entryId: 'E', replyAll: true, html: '<p>Hej</p>', attachments: ['C:\\x\\a.txt'], token: 'tok1' });
    await flush();
    await p;
    expect(children[0].requests.at(-1)).toEqual({ id: expect.any(Number), op: 'reply', args: { entryId: 'E', replyAll: true, html: '<p>Hej</p>', attachments: ['C:\\x\\a.txt'], token: 'tok1' } });
  });

  it('gives sending a longer timeout than the default', async () => {
    make();
    source.start();
    await flush();
    responder = () => {};
    let settled = false;
    const p = source.sendToSelf('s', 't');
    p.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(61_000);
    await assertion;
  });

  it('findSent returns the header or null', async () => {
    make();
    source.start();
    await flush();
    responder = (c, req) => c.ok(req.id, { item: header('S1', '2026-01-01T00:00:00Z', 'Re: x', { folder: 'sent', sendToken: 'tok' }) });
    const a = source.findSent('tok', 30);
    await flush();
    expect(await a).toMatchObject({ entryId: 'S1', folder: 'sent', sendToken: 'tok' });
    responder = (c, req) => c.ok(req.id, { item: null });
    const b = source.findSent('tok', 30);
    await flush();
    expect(await b).toBeNull();
  });

  it('stop kills the bridge, rejects pending work and ends in off', async () => {
    make();
    source.start();
    await flush();
    responder = () => {};
    const p = source.unreadOf(['a']);
    p.catch(() => {});
    await flush();
    const stopping = source.stop();
    await flush();
    await stopping;
    expect(children[0].stdin.writableEnded).toBe(true);
    await expect(p).rejects.toBeInstanceOf(MailSourceError);
    expect(source.status().state).toBe('off');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
