import { describe, expect, it } from 'vitest';
import { LineSplitter, encodeRequest, parseReply, pickSortHeaders, toHeader, toMessage } from './protocol';

describe('encodeRequest', () => {
  it('writes one JSON line', () => {
    const line = encodeRequest(7, 'get', { entryId: 'abc' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.indexOf('\n')).toBe(line.length - 1);
    expect(JSON.parse(line)).toEqual({ id: 7, op: 'get', args: { entryId: 'abc' } });
  });

  it('keeps line breaks inside strings escaped', () => {
    const line = encodeRequest(1, 'send-to-self', { text: 'a\r\nb' });
    expect(line.split('\n')).toHaveLength(2);
  });
});

describe('LineSplitter', () => {
  it('joins a line that arrives in pieces', () => {
    const s = new LineSplitter();
    expect(s.push('{"id":1,"ok"')).toEqual([]);
    expect(s.push(':true}\n{"id":2')).toEqual(['{"id":1,"ok":true}']);
    expect(s.push(',"ok":true}\n')).toEqual(['{"id":2,"ok":true}']);
  });

  it('handles CRLF and several lines in one chunk', () => {
    const s = new LineSplitter();
    expect(s.push('{"a":1}\r\n{"b":2}\r\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('ignores lines that do not start with a brace', () => {
    const s = new LineSplitter();
    expect(s.push('WARNING: something\n\n{"a":1}\nplain\n')).toEqual(['{"a":1}']);
  });

  it('drops a runaway line instead of growing forever', () => {
    const s = new LineSplitter(10);
    expect(s.push('{"aaaaaaaaaaaaaaaaaaaa')).toEqual([]);
    expect(s.push('}\n{"b":1}\n')).toEqual(['{"b":1}']);
  });
});

describe('parseReply', () => {
  it('reads an ok reply', () => {
    expect(parseReply('{"id":3,"ok":true,"result":{"x":1}}')).toEqual({ id: 3, ok: true, result: { x: 1 } });
  });

  it('reads an error reply and defaults an unknown code to failed', () => {
    expect(parseReply('{"id":3,"ok":false,"error":"nope","code":"not-running"}')).toEqual({ id: 3, ok: false, error: 'nope', code: 'not-running' });
    expect(parseReply('{"id":3,"ok":false,"error":"nope","code":"weird"}')).toMatchObject({ ok: false, code: 'failed' });
    expect(parseReply('{"id":null,"ok":false}')).toMatchObject({ id: null, ok: false, code: 'failed' });
  });

  it('rejects things that are not replies', () => {
    expect(parseReply('not json')).toBeNull();
    expect(parseReply('[1]')).toBeNull();
    expect(parseReply('{"id":1}')).toBeNull();
  });
});

describe('pickSortHeaders', () => {
  it('unfolds continuation lines, lower-cases names and keeps only the five', () => {
    const raw = [
      'Received: from mx.example.org',
      '\tby smtp.example.org',
      'List-Unsubscribe: <https://example.org/u/1>,',
      '  <mailto:unsub@example.org>',
      'PRECEDENCE: bulk',
      'Subject: Hello',
      'X-Auto-Response-Suppress: OOF, AutoReply',
      'Auto-Submitted: auto-generated',
      'List-Id: <news.example.org>',
    ].join('\r\n');
    expect(pickSortHeaders(raw)).toEqual({
      'list-unsubscribe': '<https://example.org/u/1>, <mailto:unsub@example.org>',
      precedence: 'bulk',
      'x-auto-response-suppress': 'OOF, AutoReply',
      'auto-submitted': 'auto-generated',
      'list-id': '<news.example.org>',
    });
  });

  it('returns nothing for empty or header-less text', () => {
    expect(pickSortHeaders('')).toEqual({});
    expect(pickSortHeaders('just text without colon')).toEqual({});
  });
});

describe('toHeader / toMessage', () => {
  it('maps a full record', () => {
    const h = toHeader({
      entryId: 'E1', storeId: 'S1', internetId: '<m1@example.org>', conversationId: 'C1', folder: 'sent',
      messageClass: 'IPM.Note',
      from: { name: 'Anna Exempel', address: 'anna@example.com' },
      to: [{ name: 'Bo Exempel', address: 'bo@example.org' }],
      cc: [],
      subject: 'Test', at: '2026-01-02T03:04:05.0000000Z', unread: true,
      attachments: [{ index: 1, name: 'a.pdf', size: 12, inline: false }],
      rawHeaders: 'Precedence: bulk', sendToken: 'tok',
    });
    expect(h).toMatchObject({
      entryId: 'E1', folder: 'sent', unread: true, sendToken: 'tok',
      from: { address: 'anna@example.com' }, to: [{ address: 'bo@example.org' }],
      attachments: [{ index: 1, name: 'a.pdf', size: 12, inline: false }],
      headers: { precedence: 'bulk' },
    });
  });

  it('turns missing fields into empty values', () => {
    const h = toHeader({}, 'inbox');
    expect(h).toEqual({
      entryId: '', storeId: '', internetId: '', conversationId: '', folder: 'inbox', messageClass: 'IPM.Note',
      from: { name: '', address: '' }, to: [], cc: [], subject: '', at: '', unread: false,
      attachments: [], headers: {}, sendToken: '',
    });
    expect(toHeader(null).entryId).toBe('');
    expect(toHeader('garbage').subject).toBe('');
  });

  it('survives wrong types', () => {
    const h = toHeader({ entryId: 5, to: 'x', from: 3, attachments: [null, { index: 'x' }], unread: 'yes' });
    expect(h.entryId).toBe('5');
    expect(h.to).toEqual([]);
    expect(h.from).toEqual({ name: '', address: '' });
    expect(h.attachments).toEqual([{ index: 0, name: '', size: 0, inline: false }]);
    expect(h.unread).toBe(false);
  });

  it('adds body fields for a message', () => {
    expect(toMessage({ entryId: 'E', bodyText: 'Hej', bodyHtml: '<p>Hej</p>', truncated: true })).toMatchObject({
      bodyText: 'Hej', bodyHtml: '<p>Hej</p>', truncated: true,
    });
    expect(toMessage({ entryId: 'E', bodyHtml: '' })).toMatchObject({ bodyText: '', bodyHtml: null, truncated: false });
  });
});
