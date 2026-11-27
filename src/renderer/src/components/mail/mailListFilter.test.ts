import { describe, expect, it } from 'vitest';
import type { MailItemView, MailRule } from '../../../../shared/contracts';
import { DEFAULT_FILTER, countByCategory, filterMail, groupRules, hasRule, needsAttention, normaliseSubjectPattern, senderPattern, statusText } from './mailListFilter';

function item(over: Partial<MailItemView>): MailItemView {
  return {
    id: 1, threadId: 't', from: { name: 'Anna Exempel', address: 'Anna@Example.com' }, subject: 'Hej', at: '2026-01-01T10:00:00Z',
    category: 'info', summary: '', reason: '', suggestedAction: '', needsAction: false, phishing: false,
    status: 'triaged', handled: null, attachmentCount: 0, agent: null, draft: null, ...over,
  };
}

describe('filterMail', () => {
  const items = [
    item({ id: 1, category: 'junk', at: '2026-01-01T10:00:00Z' }),
    item({ id: 2, category: 'reply', at: '2026-01-02T10:00:00Z' }),
    item({ id: 3, category: 'bulk', at: '2026-01-03T10:00:00Z' }),
    item({ id: 4, category: null, at: '2026-01-04T10:00:00Z' }),
    item({ id: 5, category: 'info', handled: 'dropped', at: '2026-01-05T10:00:00Z' }),
  ];
  it('hides junk and bulk by default and sorts newest first', () => {
    expect(filterMail(items, DEFAULT_FILTER).map((m) => m.id)).toEqual([5, 4, 2]);
  });
  it('shows them with showQuiet', () => {
    expect(filterMail(items, { ...DEFAULT_FILTER, showQuiet: true }).map((m) => m.id)).toEqual([5, 4, 3, 2, 1]);
  });
  it('a category chip shows that category even when quiet', () => {
    expect(filterMail(items, { ...DEFAULT_FILTER, category: 'junk' }).map((m) => m.id)).toEqual([1]);
  });
  it('can leave out handled mail', () => {
    expect(filterMail(items, { ...DEFAULT_FILTER, showHandled: false }).map((m) => m.id)).toEqual([4, 2]);
  });
  it('searches subject, sender and summary', () => {
    const list = [item({ id: 1, subject: 'Faktura' }), item({ id: 2, summary: 'ny offert', from: { name: 'Bo', address: 'bo@example.org' } })];
    expect(filterMail(list, { ...DEFAULT_FILTER, query: 'FAKT' }).map((m) => m.id)).toEqual([1]);
    expect(filterMail(list, { ...DEFAULT_FILTER, query: 'example.org' }).map((m) => m.id)).toEqual([2]);
    expect(filterMail(list, { ...DEFAULT_FILTER, query: 'offert' }).map((m) => m.id)).toEqual([2]);
  });
});

describe('countByCategory', () => {
  it('counts per category and can skip handled', () => {
    const list = [item({ category: 'reply' }), item({ category: 'reply', handled: 'done' }), item({ category: null })];
    expect(countByCategory(list, true).reply).toBe(2);
    expect(countByCategory(list, false).reply).toBe(1);
    expect(countByCategory(list, true).junk).toBe(0);
  });
});

describe('statusText and needsAttention', () => {
  it('prefers handled, then draft, then chat, then triage', () => {
    expect(statusText(item({ handled: 'replied', draft: 'proposed' }))).toBe('Besvarad');
    expect(statusText(item({ draft: 'proposed' }))).toBe('Utkast klart');
    expect(statusText(item({ status: 'in_chat' }))).toBe('Med agenten');
    expect(statusText(item({ status: 'triaging' }))).toBe('Sorteras');
    expect(statusText(item({}))).toBe('');
  });
  it('counts unhandled attention categories only', () => {
    expect(needsAttention(item({ category: 'action' }))).toBe(true);
    expect(needsAttention(item({ category: 'action', handled: 'done' }))).toBe(false);
    expect(needsAttention(item({ category: 'info' }))).toBe(false);
    expect(needsAttention(item({ category: null }))).toBe(false);
  });
});

describe('rules', () => {
  const rules: MailRule[] = [
    { id: 1, kind: 'never_ai_subject', pattern: 'lösenord' },
    { id: 2, kind: 'ignore_sender', pattern: 'b@example.com' },
    { id: 3, kind: 'ignore_sender', pattern: 'a@example.com' },
  ];
  it('lowercases the sender and subject patterns', () => {
    expect(senderPattern(item({}))).toBe('anna@example.com');
    expect(normaliseSubjectPattern('  Ditt   Lösenord ')).toBe('ditt lösenord');
  });
  it('finds an existing rule regardless of case', () => {
    expect(hasRule(rules, 'ignore_sender', 'A@Example.com')).toBe(true);
    expect(hasRule(rules, 'important_sender', 'a@example.com')).toBe(false);
    expect(hasRule(rules, 'ignore_sender', '')).toBe(false);
  });
  it('groups by kind in a fixed order, patterns sorted', () => {
    const g = groupRules(rules);
    expect(g.map((x) => x.kind)).toEqual(['ignore_sender', 'never_ai_subject']);
    expect(g[0].rules.map((r) => r.pattern)).toEqual(['a@example.com', 'b@example.com']);
  });
});
