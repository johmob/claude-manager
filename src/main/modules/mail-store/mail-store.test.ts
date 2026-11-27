import { describe, expect, it } from 'vitest';
import type { MailMessage } from '../../../shared/contracts';
import { createMailStore, threadKey, ftsQuery, type MailStore } from './index';

let seq = 0;
function msg(over: Partial<MailMessage> = {}): MailMessage {
  seq++;
  return {
    entryId: `E${seq}`, storeId: 'S', internetId: `<m${seq}@example.org>`, conversationId: 'AABB01',
    folder: 'inbox', messageClass: 'IPM.Note',
    from: { name: 'Anna Exempel', address: 'Anna@Example.com' },
    to: [{ name: 'Me', address: 'me@example.org' }], cc: [],
    subject: 'Offert för bord', at: '2026-03-01T10:00:00.000Z', unread: true,
    attachments: [], headers: {}, sendToken: '', bodyText: 'Hej, kan ni skicka en offert?', bodyHtml: null, truncated: false,
    ...over,
  };
}
const triage = (category: 'reply' | 'junk' | 'info' | 'action' = 'reply') =>
  ({ category, source: 'model' as const, summary: 's', reason: 'r', suggestedAction: 'a', needsAction: true, phishing: false });

function fresh(at = '2026-03-02T00:00:00.000Z'): { s: MailStore; clock: { t: Date } } {
  const clock = { t: new Date(at) };
  return { s: createMailStore(':memory:', () => clock.t), clock };
}

describe('threadKey', () => {
  it('uses the lower-cased conversation id', () => {
    expect(threadKey(msg({ conversationId: ' AbCd ' }))).toBe('abcd');
  });
  it('falls back to a hash of subject and counterpart, ignoring Re:/Sv: and case', () => {
    const a = threadKey(msg({ conversationId: '', subject: 'Offert' }));
    const b = threadKey(msg({ conversationId: '', subject: 'SV: Re: offert', from: { name: '', address: 'ANNA@example.com' } }));
    expect(a).toMatch(/^s-[0-9a-f]{24}$/);
    expect(a).toBe(b);
    expect(threadKey(msg({ conversationId: '', subject: 'Annat' }))).not.toBe(a);
  });
  it('uses the first recipient as counterpart for sent mail', () => {
    const sent = threadKey(msg({ conversationId: '', folder: 'sent', subject: 'Offert', to: [{ name: '', address: 'anna@example.com' }] }));
    expect(sent).toBe(threadKey(msg({ conversationId: '', subject: 'Offert' })));
  });
});

describe('mail store', () => {
  it('migrates once and keeps meta', () => {
    const { s } = fresh();
    expect(s.getMeta('inbox_watermark')).toBeNull();
    s.setMeta('inbox_watermark', 'x');
    s.setMeta('inbox_watermark', 'y');
    expect(s.getMeta('inbox_watermark')).toBe('y');
  });

  it('inserts once per entry id and upserts the thread', () => {
    const { s } = fresh();
    const m = msg();
    const id = s.insertMail(m, 'in');
    expect(id).toBeGreaterThan(0);
    expect(s.insertMail(m, 'in')).toBeNull();
    expect(s.hasEntry(m.entryId)).toBe(true);
    s.insertMail(msg({ subject: 'Sv: Offert för bord' }), 'in');
    expect(s.thread('aabb01')?.subject).toBe('Offert för bord');
    expect(s.threadMails('aabb01')).toHaveLength(2);
    expect(s.item(id!)?.from.address).toBe('anna@example.com');
  });

  it('moves entry ids', () => {
    const { s } = fresh();
    const m = msg();
    s.insertMail(m, 'in');
    expect(s.updateEntryId(m.entryId, 'NEW')).toBe(true);
    expect(s.hasEntry('NEW')).toBe(true);
    expect(s.hasEntry(m.entryId)).toBe(false);
  });

  it('runs the triage and handle flow', () => {
    const { s } = fresh();
    const id = s.insertMail(msg(), 'in')!;
    expect(s.untriaged()).toEqual([id]);
    expect(s.triagingCount()).toBe(1);
    s.setTriage(id, triage('reply'));
    expect(s.item(id)).toMatchObject({ category: 'reply', status: 'triaged', needsAction: true });
    expect(s.triagingCount()).toBe(0);
    s.setCategory(id, 'info');
    expect(s.item(id)?.category).toBe('info');
    s.handle(id, 'dropped');
    expect(s.item(id)).toMatchObject({ status: 'handled', handled: 'dropped' });
    s.reopen(id);
    expect(s.item(id)).toMatchObject({ status: 'triaged', handled: null });
  });

  it('lists attention newest first, only unhandled attention categories', () => {
    const { s } = fresh();
    const a = s.insertMail(msg({ at: '2026-03-01T08:00:00.000Z' }), 'in')!;
    const b = s.insertMail(msg({ at: '2026-03-01T09:00:00.000Z' }), 'in')!;
    const c = s.insertMail(msg(), 'in')!;
    const d = s.insertMail(msg(), 'in')!;
    s.setTriage(a, triage('reply'));
    s.setTriage(b, triage('action'));
    s.setTriage(c, triage('junk'));
    s.setTriage(d, triage('reply'));
    s.handle(d, 'done');
    s.insertMail(msg({ folder: 'sent' }), 'out');
    expect(s.attention().map((i) => i.id)).toEqual([b, a]);
  });

  it('counts per category since a date', () => {
    const { s } = fresh();
    const a = s.insertMail(msg({ at: '2026-03-01T08:00:00.000Z' }), 'in')!;
    const b = s.insertMail(msg({ at: '2026-02-01T08:00:00.000Z' }), 'in')!;
    s.setTriage(a, triage('junk'));
    s.setTriage(b, triage('junk'));
    const counts = s.counts('2026-02-20T00:00:00.000Z');
    expect(counts.junk).toBe(1);
    expect(counts.reply).toBe(0);
    expect(s.recent(7).map((i) => i.id)).toEqual([a]);
  });

  it('versions drafts and supersedes the previous one', () => {
    const { s } = fresh();
    const id = s.insertMail(msg(), 'in')!;
    const d1 = s.startDraft(id, '');
    expect(s.item(id)?.draft).toBe('writing');
    expect(s.proposeDraft(id, { body: 'Hej', replyAll: false, attachments: [{ path: 'C:\\x\\a.pdf', name: 'a.pdf' }] })).toBe(d1);
    expect(s.latestDraft(id)).toMatchObject({ version: 1, status: 'proposed', body: 'Hej' });
    const d2 = s.startDraft(id, 'kortare');
    expect(d2).not.toBe(d1);
    expect(s.latestDraft(id)).toMatchObject({ version: 2, status: 'writing' });
    s.proposeDraft(id, { body: 'Hej!', replyAll: true, attachments: [] });
    expect(s.latestDraft(id)).toMatchObject({ version: 2, status: 'proposed', replyAll: true });
    s.failDraft(id, 'boom');
    expect(s.latestDraft(id)).toMatchObject({ status: 'failed', error: 'boom' });
    expect(s.item(id)?.draft).toBe('failed');
    // proposing without a writing draft creates one
    const d3 = s.proposeDraft(id, { body: 'Tredje', replyAll: false, attachments: [] });
    expect(s.latestDraft(id)).toMatchObject({ id: d3, version: 3, status: 'proposed' });
  });

  it('matches a send token and flags edits', () => {
    const { s } = fresh();
    const id = s.insertMail(msg(), 'in')!;
    s.startDraft(id, '');
    const d = s.proposeDraft(id, { body: 'Hej\r\nHälsningar', replyAll: false, attachments: [] });
    s.draftSent(d, 'Hej\nHälsningar ', 'tok1');
    expect(s.matchSentToken('tok1')).toEqual({ draftId: d, edited: false });
    const d2 = s.startDraft(id, '');
    s.proposeDraft(id, { body: 'A', replyAll: false, attachments: [] });
    s.draftSent(d2, 'B', 'tok2');
    expect(s.matchSentToken('tok2')).toEqual({ draftId: d2, edited: true });
    expect(s.matchSentToken('nope')).toBeNull();
    s.draftDeclined(d2);
    expect(s.latestDraft(id)?.status).toBe('declined');
  });

  it('stores out mail with authorship and token', () => {
    const { s } = fresh();
    const id = s.insertMail(msg({ folder: 'sent' }), 'out', { authorship: 'agent_edited', sendToken: 't' })!;
    expect(s.item(id)?.status).toBe('handled');
    const other = s.insertMail(msg({ folder: 'sent' }), 'out')!;
    expect(other).toBeGreaterThan(id);
  });

  it('keeps thread session, summary and events', () => {
    const { s } = fresh();
    const id = s.insertMail(msg(), 'in')!;
    s.setThreadSession('aabb01', 'sess-1');
    s.setThreadSummary('aabb01', 'Kunden vill ha offert.');
    expect(s.thread('aabb01')).toMatchObject({ claudeSessionId: 'sess-1', summary: 'Kunden vill ha offert.' });
    s.addEvent('aabb01', id, 'note', { text: 'x' });
    s.addEvent('aabb01', null, 'file', { name: 'f.txt' });
    expect(s.threadEvents('aabb01', 10).map((e) => e.kind).sort()).toEqual(['file', 'note']);
    expect(s.threadEvents('aabb01', 1)).toHaveLength(1);
    expect(s.message(id)).toMatchObject({ threadId: 'aabb01', bodyText: 'Hej, kan ni skicka en offert?' });
  });

  it('returns message class and sorting headers for a restart', () => {
    const { s } = fresh();
    const id = s.insertMail(msg({ messageClass: 'IPM.Schedule.Meeting.Request', headers: { 'list-id': '<l.example.org>' } }), 'in')!;
    expect(s.message(id)).toMatchObject({ messageClass: 'IPM.Schedule.Meeting.Request', headers: { 'list-id': '<l.example.org>' } });
  });

  it('computes sender stats within 180 days only', () => {
    const { s, clock } = fresh('2026-01-01T00:00:00.000Z');
    s.addLearning({ mailId: null, fromAddr: 'Old@Example.com', category: 'info', choice: 'drop' });
    clock.t = new Date('2026-09-01T00:00:00.000Z');
    s.addLearning({ mailId: null, fromAddr: 'a@example.com', category: 'info', choice: 'drop' });
    s.addLearning({ mailId: null, fromAddr: 'a@example.com', category: 'info', choice: 'drop' });
    s.addLearning({ mailId: null, fromAddr: 'b@example.com', category: 'reply', choice: 'sent_edited', edit: { added: 3 } });
    const st = s.senderStats('a@example.com', 'example.com');
    expect(st.total).toBe(3);
    expect(st.byChoice).toEqual({ drop: 2, sent_edited: 1 });
    expect(st.byCategory).toEqual({ info: 2, reply: 1 });
    expect(s.senderStats('a@example.com', 'other.org').total).toBe(2);
  });

  it('normalises and de-duplicates rules', () => {
    const { s } = fresh();
    s.setRule('ignore_sender', '  @Example.ORG ', true);
    const rules = s.setRule('ignore_sender', '@example.org', true);
    expect(rules).toHaveLength(1);
    expect(rules[0].pattern).toBe('@example.org');
    s.setRule('never_ai_subject', '   ', true);
    expect(s.rules()).toHaveLength(1);
    expect(s.setRule('ignore_sender', '@EXAMPLE.org', false)).toHaveLength(0);
  });

  it('searches with FTS and survives syntax characters', () => {
    const { s } = fresh();
    const id = s.insertMail(msg({ subject: 'Leverans av pallar', bodyText: 'Pallarna kommer fredag' }), 'in')!;
    s.insertMail(msg({ subject: 'Annat', bodyText: 'Inget om det' }), 'in');
    expect(s.search('pallar', 10).map((i) => i.id)).toEqual([id]);
    expect(s.search('fredag', 10)).toHaveLength(1);
    for (const q of ['"', 'pallar*', '-pallar', 'a AND (', 'x:"y', '***', '']) expect(() => s.search(q, 10)).not.toThrow();
    expect(ftsQuery('say "hi" -now*')).toBe('"say" "hi" "-now*"');
  });

  it('keeps FTS in sync when a body is pruned', () => {
    const { s } = fresh('2026-06-01T00:00:00.000Z');
    const id = s.insertMail(msg({ bodyText: 'unikordet här' }), 'in')!;
    expect(s.search('unikordet', 5)).toHaveLength(1);
    s.setTriage(id, triage('junk'));
    expect(s.prune()).toBe(1);
    expect(s.search('unikordet', 5)).toHaveLength(0);
  });

  it('prunes bodies only where it should', () => {
    const { s } = fresh('2027-06-01T00:00:00.000Z');
    const old = '2026-01-01T00:00:00.000Z';
    const junk = s.insertMail(msg({ at: old }), 'in')!;
    s.setTriage(junk, triage('junk'));
    const recentJunk = s.insertMail(msg({ at: '2027-05-25T00:00:00.000Z' }), 'in')!;
    s.setTriage(recentJunk, triage('junk'));
    const oldReply = s.insertMail(msg({ at: old, conversationId: 'c-open' }), 'in')!;
    s.setTriage(oldReply, triage('reply'));
    const oldHandled = s.insertMail(msg({ at: old, conversationId: 'c-h' }), 'in')!;
    s.handle(oldHandled, 'done');
    const keptThread = s.insertMail(msg({ at: old, conversationId: 'c-s' }), 'in')!;
    s.handle(keptThread, 'done');
    s.setThreadSession('c-s', 'sess');
    expect(s.prune()).toBe(2);
    expect(s.message(junk)?.bodyText).toBe('');
    expect(s.message(oldHandled)?.bodyText).toBe('');
    expect(s.message(recentJunk)?.bodyText).not.toBe('');
    expect(s.message(oldReply)?.bodyText).not.toBe('');
    expect(s.message(keptThread)?.bodyText).not.toBe('');
  });
});
