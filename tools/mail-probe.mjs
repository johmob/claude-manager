// Manual check of the Outlook bridge (resources/outlook-bridge.ps1) against the real, running classic Outlook.
// Prints ONLY counts, booleans and timings: never addresses, subjects or bodies.
//
//   node tools/mail-probe.mjs              read-only: hello, account, last 24 h of the inbox, the newest mail, its conversation
//   node tools/mail-probe.mjs --send-test  also sends one test mail to the account's own address, replies to it,
//                                          finds both again and marks them read (waits up to 15 minutes per step)
//
// Nothing else is touched, and no mail is sent to anyone but the account itself.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'resources', 'outlook-bridge.ps1');
const sendTest = process.argv.includes('--send-test');

const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ParentPid', String(process.pid)], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderrLines = 0;
child.stderr.on('data', (d) => { stderrLines += String(d).split('\n').filter((l) => l.trim()).length; });

let nextId = 1;
const waiting = new Map();
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let at;
  while ((at = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, at).replace(/\r$/, '');
    buf = buf.slice(at + 1);
    if (!line.startsWith('{')) continue;
    let reply;
    try { reply = JSON.parse(line); } catch { continue; }
    const w = waiting.get(reply.id);
    if (w) { waiting.delete(reply.id); w(reply); }
  }
});
child.on('exit', (code) => {
  for (const w of waiting.values()) w({ ok: false, code: 'failed', error: `bridge exited (${code})` });
  waiting.clear();
});

function call(op, args = {}, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const id = nextId++;
    const t0 = performance.now();
    const timer = setTimeout(() => { waiting.delete(id); resolve({ ok: false, code: 'timeout', error: 'timeout', ms: timeoutMs }); }, timeoutMs);
    waiting.set(id, (reply) => { clearTimeout(timer); resolve({ ...reply, ms: Math.round(performance.now() - t0) }); });
    child.stdin.write(JSON.stringify({ id, op, args }) + '\n');
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (key, value) => console.log(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
const nonEmpty = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.length > 0 : v != null);

function shape(h) {
  const keys = ['entryId', 'storeId', 'internetId', 'conversationId', 'messageClass', 'subject', 'at', 'rawHeaders'];
  const o = {};
  for (const k of keys) o[k] = nonEmpty(h[k]);
  o.fromName = nonEmpty(h.from?.name);
  o.fromAddressIsSmtp = typeof h.from?.address === 'string' && /^[^@\s]+@[^@\s]+$/.test(h.from.address);
  o.to = (h.to ?? []).length;
  o.cc = (h.cc ?? []).length;
  o.attachments = (h.attachments ?? []).length;
  return o;
}

function fail(step, r) {
  say(`${step}.ok`, false);
  say(`${step}.code`, r.code);
  say(`${step}.error`, r.error);
}

async function pollFor(find, label, maxMs = 15 * 60_000, everyMs = 20_000) {
  const t0 = performance.now();
  for (;;) {
    const found = await find();
    const seconds = Math.round((performance.now() - t0) / 1000);
    if (found) { say(`${label}.found`, true); say(`${label}.seconds`, seconds); return found; }
    if (performance.now() - t0 > maxMs) { say(`${label}.found`, false); say(`${label}.seconds`, seconds); return null; }
    await sleep(everyMs);
  }
}

async function main() {
  const hello = await call('hello');
  if (!hello.ok) { fail('hello', hello); return; }
  say('hello.ms', hello.ms);
  say('languageMode', hello.result.languageMode);
  say('psVersion', hello.result.psVersion);
  say('outlookVersion', hello.result.outlookVersion);
  say('attached', hello.result.attached);
  if (!hello.result.attached) { say('stopped', 'Outlook is not running'); return; }

  const acc = await call('account');
  say('account.ms', acc.ms);
  say('accountFound', acc.ok && acc.result.found === true);
  const accountAddress = acc.ok ? String(acc.result.address || '') : '';

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const list = await call('list-since', { folder: 'inbox', since, max: 200 });
  if (!list.ok) { fail('listInbox', list); return; }
  const items = list.result.items ?? [];
  say('inbox24h.count', items.length);
  say('inbox24h.ms', list.ms);
  say('inbox24h.unread', items.filter((i) => i.unread).length);
  say('inbox24h.withSmtpSender', items.filter((i) => /^[^@\s]+@[^@\s]+$/.test(i.from?.address ?? '')).length);
  say('inbox24h.withTransportHeaders', items.filter((i) => i.rawHeaders).length);
  say('inbox24h.withConversationId', items.filter((i) => i.conversationId).length);
  say('inbox24h.withAttachments', items.filter((i) => (i.attachments ?? []).length > 0).length);
  say('inbox24h.nonNoteClasses', items.filter((i) => i.messageClass && !i.messageClass.startsWith('IPM.Note')).length);

  const sent = await call('list-since', { folder: 'sent', since, max: 200 });
  say('sent24h.count', sent.ok ? (sent.result.items ?? []).length : -1);
  say('sent24h.ms', sent.ms);

  // Newest mail overall (inbox): which fields are filled.
  let newest = items[0];
  if (!newest) {
    const wide = await call('list-since', { folder: 'inbox', since: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), max: 1 });
    newest = wide.ok ? (wide.result.items ?? [])[0] : undefined;
  }
  if (newest) {
    const got = await call('get', { entryId: newest.entryId, html: true });
    say('get.ok', got.ok);
    say('get.ms', got.ms);
    if (got.ok) {
      const r = got.result;
      say('get.fields', shape(r));
      say('get.folder', r.folder);
      say('get.isNote', typeof r.messageClass === 'string' && r.messageClass.startsWith('IPM.Note'));
      say('get.bodyTextLength', (r.bodyText ?? '').length);
      say('get.bodyHtml', nonEmpty(r.bodyHtml));
      say('get.truncated', r.truncated === true);
    } else fail('get', got);
    const conv = await call('conversation', { entryId: newest.entryId });
    say('conversation.ok', conv.ok);
    say('conversation.ms', conv.ms);
    say('conversation.count', conv.ok ? (conv.result.items ?? []).length : -1);
    if (conv.ok) {
      const its = conv.result.items ?? [];
      say('conversation.inbox', its.filter((i) => i.folder === 'inbox').length);
      say('conversation.sent', its.filter((i) => i.folder === 'sent').length);
    }
    const un = await call('unread-of', { entryIds: [newest.entryId, 'not-an-id'] });
    say('unreadOf.ok', un.ok);
    say('unreadOf.count', un.ok ? (un.result.unread ?? []).length : -1);
  } else {
    say('get', 'no mail to try');
  }

  if (!sendTest) return;
  if (!accountAddress) { say('sendTest', 'skipped: no account address'); return; }

  // ---- send to self, wait for it, reply to it, wait for the sent copy ----
  const tag = randomBytes(3).toString('hex');
  const subject = `Claude Manager test ${tag}`;
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const sent1 = await call('send-to-self', { subject, text: 'Detta är ett automatiskt test. Kan du bekräfta att du fått det?' });
  say('sendToSelf.ok', sent1.ok);
  say('sendToSelf.ms', sent1.ms);
  if (!sent1.ok) { fail('sendToSelf', sent1); return; }

  const received = await pollFor(async () => {
    const r = await call('list-since', { folder: 'inbox', since: startedAt, max: 50, subjectPrefix: 'Claude Manager test' });
    return r.ok ? (r.result.items ?? []).find((i) => (i.subject ?? '').includes(tag)) : null;
  }, 'testMailArrived');
  if (!received) return;
  say('testMail.fields', shape(received));

  const token = `probe-${tag}`;
  const rep = await call('reply', { entryId: received.entryId, replyAll: false, html: '<p>Testsvar.</p>', attachments: [], token });
  say('reply.ok', rep.ok);
  say('reply.ms', rep.ms);
  if (!rep.ok) { fail('reply', rep); }
  else {
    const copy = await pollFor(async () => {
      const r = await call('find-sent', { token, withinMinutes: 30 });
      return r.ok ? r.result.item : null;
    }, 'sentCopyWithToken');
    if (copy) say('sentCopy.tokenMatches', copy.sendToken === token);
  }

  // Mark the test mails read: the one that arrived and the reply's inbound copy (when it has arrived).
  const toMark = [received.entryId];
  const replyBack = await pollFor(async () => {
    const r = await call('list-since', { folder: 'inbox', since: startedAt, max: 50 });
    return r.ok ? (r.result.items ?? []).find((i) => (i.subject ?? '').includes(tag) && i.entryId !== received.entryId) : null;
  }, 'replyArrived', 5 * 60_000);
  if (replyBack) toMark.push(replyBack.entryId);
  let marked = 0;
  for (const id of toMark) {
    const m = await call('mark-read', { entryId: id });
    if (m.ok) marked++;
  }
  say('markRead.count', marked);
  const still = await call('unread-of', { entryIds: toMark });
  say('markRead.stillUnread', still.ok ? (still.result.unread ?? []).length : -1);
}

try {
  await main();
} finally {
  say('stderrLines', stderrLines);
  child.stdin.end();
  setTimeout(() => child.kill(), 2000).unref();
}
