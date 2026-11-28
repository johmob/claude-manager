import { describe, expect, it } from 'vitest';
import type { MailHeader } from '../shared/contracts';
import { cidKey, cidRefs, imageMime, replaceCids, agentState, isRiskyAttachment, attachmentPath, cleanText, firstExisting, hintStats, idOf, isInside, sanitiseFileName, selectIngest, sendErrorText, threadDirOf } from './mail-root-helpers';

const header = (entryId: string, at: string, unread: boolean): MailHeader => ({
  entryId, storeId: '', internetId: '', conversationId: '', folder: 'inbox', messageClass: 'IPM.Note',
  from: { name: 'Anna Exempel', address: 'anna@example.com' }, to: [], cc: [], subject: 'Hej', at, unread, attachments: [], headers: {}, sendToken: '',
});

describe('selectIngest', () => {
  const first = '2026-01-10T00:00:00.000Z';
  it('takes only unread items from before the first start, and everything after', () => {
    const out = selectIngest([
      header('old-read', '2026-01-08T10:00:00.000Z', false),
      header('old-unread', '2026-01-09T10:00:00.000Z', true),
      header('new-read', '2026-01-10T10:00:00.000Z', false),
      header('new-unread', '2026-01-11T10:00:00.000Z', true),
    ], first);
    expect(out.map((h) => h.entryId)).toEqual(['old-unread', 'new-read', 'new-unread']);
  });
  it('caps the backfill to the newest unread and keeps oldest first', () => {
    const items = ['01', '02', '03', '04'].map((d) => header(`m${d}`, `2026-01-${d}T10:00:00.000Z`, true));
    expect(selectIngest(items, first, 2).map((h) => h.entryId)).toEqual(['m03', 'm04']);
  });
  it('does not cap live items', () => {
    const items = ['11', '12', '13'].map((d) => header(`m${d}`, `2026-01-${d}T10:00:00.000Z`, true));
    expect(selectIngest(items, first, 1)).toHaveLength(3);
  });
});

describe('sanitiseFileName', () => {
  it('keeps ordinary names', () => expect(sanitiseFileName('Offert 2026.pdf')).toBe('Offert 2026.pdf'));
  it('drops path parts and reserved characters', () => {
    expect(sanitiseFileName('..\\..\\evil.exe')).toBe('evil.exe');
    expect(sanitiseFileName('a<b>c:d"e|f?g*.txt')).toBe('a_b_c_d_e_f_g_.txt');
    expect(sanitiseFileName('x/y/z.txt')).toBe('z.txt');
  });
  it('avoids reserved device names, empty names and trailing dots', () => {
    expect(sanitiseFileName('CON.txt')).toBe('_CON.txt');
    expect(sanitiseFileName('')).toBe('bilaga');
    expect(sanitiseFileName('..')).toBe('bilaga');
    expect(sanitiseFileName('rapport. ')).toBe('rapport');
  });
  it('cuts long names but keeps the extension', () => {
    const out = sanitiseFileName(`${'a'.repeat(300)}.docx`);
    expect(out.length).toBe(120);
    expect(out.endsWith('.docx')).toBe(true);
  });
});

describe('paths', () => {
  it('puts an attachment under the thread folder, per mail and index', () => {
    const p = attachmentPath('C:\\data\\mail\\threads\\abc', 7, 2, '..\\x.pdf');
    expect(p.replace(/\\/g, '/')).toBe('C:/data/mail/threads/abc/attachments/7-2/x.pdf');
  });
  it('keeps a thread key inside the threads folder', () => {
    expect(threadDirOf('C:\\data\\mail', 'ab12').replace(/\\/g, '/')).toBe('C:/data/mail/threads/ab12');
    expect(threadDirOf('C:\\data\\mail', '..\\..\\x').replace(/\\/g, '/')).toBe('C:/data/mail/threads/______x');
  });
  it('isInside is case-insensitive and rejects siblings with the same prefix', () => {
    expect(isInside('C:\\data\\mail', 'c:\\DATA\\mail\\threads\\a.txt')).toBe(true);
    expect(isInside('C:\\data\\mail', 'C:\\data\\mail2\\a.txt')).toBe(false);
    expect(isInside('C:\\data\\mail', 'C:\\data\\mail\\..\\x.txt')).toBe(false);
  });
});

describe('isRiskyAttachment', () => {
  it('flags macro documents and active content, not plain documents', () => {
    for (const n of ['a.docm', 'B.XLSM', 'x.html', 'x.svg', 'x.iso', 'x.url']) expect(isRiskyAttachment(n)).toBe(true);
    for (const n of ['a.docx', 'b.pdf', 'c.png', 'd.xlsx', 'e.txt']) expect(isRiskyAttachment(n)).toBe(false);
  });
});

describe('small mappings', () => {
  it('agentState', () => {
    expect(agentState(undefined)).toBeNull();
    expect(agentState('stopped')).toBeNull();
    expect(agentState('working')).toBe('working');
    expect(agentState('starting')).toBe('working');
    expect(agentState('error')).toBe('error');
    expect(agentState('done')).toBe('idle');
  });
  it('hintStats counts outcomes, not the first click', () => {
    expect(hintStats({ drop: 6, reply: 3, agent: 2, sent: 1, sent_edited: 1, declined: 1 })).toEqual({ total: 9, dropped: 6, replied: 2 });
    expect(hintStats({})).toEqual({ total: 0, dropped: 0, replied: 0 });
  });
  it('firstExisting skips empties and failures', () => {
    const exists = (p: string): boolean => {
      if (p === 'boom') throw new Error('x');
      return p === 'b';
    };
    expect(firstExisting(['', 'boom', 'a', 'b', 'c'], exists)).toBe('b');
    expect(firstExisting(['a'], exists)).toBeNull();
  });
  it('sendErrorText never repeats the bridge text', () => {
    expect(sendErrorText('not-running')).toMatch(/Outlook är inte igång/);
    expect(sendErrorText('timeout')).toMatch(/Kontrollera i Outlook/);
    expect(sendErrorText(undefined)).toMatch(/kunde inte skickas/);
  });
  it('validates renderer input', () => {
    expect(cleanText('  hej  ', 10)).toBe('hej');
    expect(cleanText('abcdef', 3)).toBe('abc');
    expect(cleanText(5, 3)).toBe('');
    expect(idOf(4)).toBe(4);
    expect(idOf(0)).toBeNull();
    expect(idOf(1.5)).toBeNull();
    expect(idOf('3')).toBeNull();
  });
});

describe('inline images', () => {
  it('finds and replaces cid references, ignoring case and brackets', () => {
    const html = "<img src=\"cid:Logo%40x.png\"><img src='cid:other'>";
    expect([...cidRefs(html)].sort()).toEqual(['logo@x.png', 'other']);
    expect(cidKey('<Logo@X.png>')).toBe('logo@x.png');
    const out = replaceCids(html, new Map([['logo@x.png', 'data:image/png;base64,AA']]));
    expect(out).toContain('src="data:image/png;base64,AA"');
    expect(out).toContain('cid:other');
  });

  it('recognises only safe image formats by their bytes', () => {
    expect(imageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]))).toBe('image/png');
    expect(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageMime(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(imageMime(Buffer.from('<svg xmlns="x"></svg>'))).toBeNull();
    expect(imageMime(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });
});
