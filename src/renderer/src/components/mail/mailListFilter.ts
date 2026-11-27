import { MAIL_ATTENTION, MAIL_CATEGORIES } from '../../../../shared/contracts';
import type { MailCategory, MailItemView, MailRule, MailRuleKind } from '../../../../shared/contracts';

export const CATEGORY_LABEL: Record<MailCategory, string> = {
  junk: 'Skräp',
  bulk: 'Utskick',
  info: 'Information',
  reply: 'Svar',
  action: 'Åtgärd',
  meeting: 'Möte',
  private: 'Ej bedömt',
};

/** Chip order: what needs the user first, then the quiet ones. */
export const CATEGORY_ORDER: readonly MailCategory[] = ['reply', 'action', 'private', 'meeting', 'info', 'bulk', 'junk'];

/** Categories hidden until "Visa skräp" is on. */
export const QUIET_CATEGORIES: readonly MailCategory[] = ['junk', 'bulk'];

export const RULE_LABEL: Record<MailRuleKind, string> = {
  ignore_sender: 'Ignorera avsändare',
  important_sender: 'Viktig avsändare',
  never_ai_sender: 'Skicka aldrig till Claude (avsändare)',
  never_ai_subject: 'Skicka aldrig till Claude (ämne)',
};

export interface MailFilter {
  /** One category, or null for everything shown. */
  category: MailCategory | null;
  showQuiet: boolean;
  /** Also list mail the user has already handled. */
  showHandled: boolean;
  query: string;
}

export const DEFAULT_FILTER: MailFilter = { category: null, showQuiet: false, showHandled: true, query: '' };

/** Items matching the filter, newest first. Uncategorised (not yet triaged) mail counts as visible. */
export function filterMail(items: MailItemView[], f: MailFilter): MailItemView[] {
  const q = f.query.trim().toLowerCase();
  return items
    .filter((m) => {
      if (f.category) return m.category === f.category;
      if (!f.showQuiet && m.category && QUIET_CATEGORIES.includes(m.category)) return false;
      return true;
    })
    .filter((m) => f.showHandled || !m.handled)
    .filter((m) => !q || `${m.subject} ${m.from.name} ${m.from.address} ${m.summary}`.toLowerCase().includes(q))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
}

/** Items per category, for the chips (counts what the filter's other parts leave in). */
export function countByCategory(items: MailItemView[], showHandled: boolean): Record<MailCategory, number> {
  const out = Object.fromEntries(MAIL_CATEGORIES.map((c) => [c, 0])) as Record<MailCategory, number>;
  for (const m of items) {
    if (!showHandled && m.handled) continue;
    if (m.category) out[m.category] += 1;
  }
  return out;
}

export function needsAttention(m: MailItemView): boolean {
  return !m.handled && m.category !== null && MAIL_ATTENTION.includes(m.category);
}

const HANDLED_TEXT: Record<NonNullable<MailItemView['handled']>, string> = {
  dropped: 'Släppt',
  replied: 'Besvarad',
  declined: 'Avstod',
  done: 'Klar',
  outlook: 'Läst i Outlook',
};

/** One short phrase for where a mail stands, or '' when it is just waiting. */
export function statusText(m: MailItemView): string {
  if (m.handled) return HANDLED_TEXT[m.handled];
  if (m.draft === 'writing') return 'Skriver utkast';
  if (m.draft === 'proposed') return 'Utkast klart';
  if (m.draft === 'failed') return 'Utkastet misslyckades';
  if (m.status === 'in_chat') return 'Med agenten';
  if (m.status === 'new' || m.status === 'triaging') return 'Sorteras';
  return '';
}

/** The sender as a rule pattern: lower-case address, or '' when there is none to match on. */
export function senderPattern(m: MailItemView): string {
  return m.from.address.trim().toLowerCase();
}

/** Rule already set for this pattern? */
export function hasRule(rules: MailRule[], kind: MailRuleKind, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  return !!p && rules.some((r) => r.kind === kind && r.pattern.toLowerCase() === p);
}

/** Subject words as a rule pattern: trimmed, lower-case, single spaces. */
export function normaliseSubjectPattern(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Rules grouped by kind in the contract's order, patterns alphabetical. */
export function groupRules(rules: MailRule[]): { kind: MailRuleKind; rules: MailRule[] }[] {
  const kinds: MailRuleKind[] = ['ignore_sender', 'important_sender', 'never_ai_sender', 'never_ai_subject'];
  return kinds
    .map((kind) => ({ kind, rules: rules.filter((r) => r.kind === kind).sort((a, b) => a.pattern.localeCompare(b.pattern)) }))
    .filter((g) => g.rules.length > 0);
}
