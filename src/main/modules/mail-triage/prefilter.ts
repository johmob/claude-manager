// Local prefilter (mail.5.2): decides without AI what it can, and keeps excluded mail away from Claude.
import type { MailAccount, MailCategory, MailHeader, MailRule } from './types';

export type PrefilterResult = { category: MailCategory; reason: string } | { ai: true; important: boolean };

function matchesSender(address: string, pattern: string): boolean {
  const a = address.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (!a || !p) return false;
  if (p.startsWith('@')) return a.endsWith(p);
  return a === p;
}

function matchesSubject(subject: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  return p !== '' && subject.toLowerCase().includes(p);
}

export function prefilter(header: MailHeader, rules: MailRule[], self: MailAccount | null): PrefilterResult {
  const addr = header.from.address;
  const has = (kind: MailRule['kind'], test: (pattern: string) => boolean) => rules.some((r) => r.kind === kind && test(r.pattern));
  const h = (name: string) => (header.headers[name] ?? '').trim().toLowerCase();

  if (has('never_ai_sender', (p) => matchesSender(addr, p)) || has('never_ai_subject', (p) => matchesSubject(header.subject, p))) {
    return { category: 'private', reason: 'Skickas inte till Claude enligt din regel' };
  }
  if (has('ignore_sender', (p) => matchesSender(addr, p))) return { category: 'junk', reason: 'Avsändaren ignoreras enligt din regel' };

  const cls = header.messageClass.toLowerCase();
  if (cls.startsWith('ipm.schedule.meeting')) return { category: 'meeting', reason: 'Mötesinbjudan eller mötessvar' };
  if (cls.startsWith('ipm.report') || cls.includes('.ndr') || cls.startsWith('report.')) return { category: 'info', reason: 'Leveransrapport' };

  if (self && addr && addr.trim().toLowerCase() === self.address.trim().toLowerCase()) return { category: 'info', reason: 'Från dig själv' };

  if (has('important_sender', (p) => matchesSender(addr, p))) return { ai: true, important: true };

  const auto = h('auto-submitted');
  if (h('list-unsubscribe') || h('list-id') || ['bulk', 'list', 'junk'].includes(h('precedence')) || (auto !== '' && auto !== 'no')) {
    return { category: 'bulk', reason: 'Nyhetsbrev eller utskick' };
  }
  if (/^(no-?reply|donotreply|do-not-reply)(\+[^@]*)?@/i.test(addr.trim())) return { category: 'info', reason: 'Automatisk avsändare (noreply)' };

  return { ai: true, important: false };
}
