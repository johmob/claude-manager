import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { MailCategory, MailItemView, MailRule, MailRuleKind } from '../../../../shared/contracts';
import { errorMessage, send } from '../../lib/api';
import { useMail } from '../../state/useMail';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  DEFAULT_FILTER,
  RULE_LABEL,
  countByCategory,
  filterMail,
  groupRules,
  hasRule,
  needsAttention,
  normaliseSubjectPattern,
  senderPattern,
  statusText,
  type MailFilter,
} from './mailListFilter';
import '../../styles/mail-list.css';

type OpenMode = 'mail' | 'draft' | 'chat';

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

/** The per-row menu: teach the sorting (mail.2.4) and set rules (mail.5.2). Closes on a click outside or Escape. */
function RowMenu({ item, rules, onRule }: { item: MailItemView; rules: MailRule[]; onRule: (kind: MailRuleKind, pattern: string, on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = (): void => {
    setOpen(false);
    setMoving(false);
  };
  const reclassify = (category: MailCategory): void => {
    send('mail:reclassify', { mailId: item.id, category });
    close();
  };
  const sender = senderPattern(item);
  const toggleRule = (kind: MailRuleKind): void => {
    const on = !hasRule(rules, kind, sender);
    onRule(kind, sender, on);
    // Ignoring a sender also files this mail as unimportant, so the list matches what the rule will do.
    if (on && kind === 'ignore_sender') send('mail:reclassify', { mailId: item.id, category: 'info' });
    close();
  };
  const ruleItem = (kind: MailRuleKind, on: string, off: string): ReactElement | null =>
    sender ? (
      <button type="button" role="menuitem" className="mail-menu-item" onClick={() => toggleRule(kind)}>
        {hasRule(rules, kind, sender) ? off : on}
      </button>
    ) : null;
  return (
    <div className="mail-row-menu" ref={ref}>
      <button type="button" className="mail-row-more" aria-haspopup="menu" aria-expanded={open} title="Fler val" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        ⋯
      </button>
      {open && (
        <div className="mail-menu-pop" role="menu" onClick={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" className="mail-menu-item" onClick={() => reclassify('info')}>Inte viktigt</button>
          {ruleItem('ignore_sender', 'Inte viktigt, alltid från avsändaren', 'Sluta ignorera avsändaren')}
          {ruleItem('important_sender', 'Viktig avsändare', 'Inte längre viktig avsändare')}
          {ruleItem('never_ai_sender', 'Skicka aldrig till Claude', 'Tillåt Claude att läsa avsändaren igen')}
          <button type="button" role="menuitem" className="mail-menu-item" aria-expanded={moving} onClick={() => setMoving(!moving)}>
            Flytta till …
          </button>
          {moving && (
            <div className="mail-menu-sub">
              {CATEGORY_ORDER.filter((c) => c !== item.category).map((c) => (
                <button key={c} type="button" role="menuitem" className="mail-menu-item" onClick={() => reclassify(c)}>{CATEGORY_LABEL[c]}</button>
              ))}
            </div>
          )}
          {item.handled && (
            <button type="button" role="menuitem" className="mail-menu-item" onClick={() => { send('mail:act', { mailId: item.id, action: 'reopen' }); close(); }}>
              Öppna igen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ item, rules, onOpen, onRule }: { item: MailItemView; rules: MailRule[]; onOpen: MailListProps['onOpen']; onRule: (kind: MailRuleKind, pattern: string, on: boolean) => void }) {
  const status = statusText(item);
  const sender = item.from.name || item.from.address;
  return (
    <li className={item.handled ? 'mail-row handled' : needsAttention(item) ? 'mail-row attention' : 'mail-row'} data-category={item.category ?? 'none'}>
      <div
        className="mail-row-main"
        role="button"
        tabIndex={0}
        onClick={() => onOpen(item.id, item.draft === 'proposed' ? 'draft' : 'mail')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(item.id, item.draft === 'proposed' ? 'draft' : 'mail');
          }
        }}
      >
        <span className="mail-row-top">
          <span className="mail-row-from">{sender}</span>
          <span className="mail-row-at">{when(item.at)}</span>
        </span>
        <span className="mail-row-subject">
          {item.phishing && <span className="mail-row-phish" title="Misstänkt nätfiske">Misstänkt</span>}
          {item.subject || '(inget ämne)'}
        </span>
        {(item.summary || item.suggestedAction) && (
          <span className="mail-row-summary" title={item.reason || undefined}>
            {item.summary}
            {item.summary && item.suggestedAction ? ' · ' : ''}
            {item.suggestedAction && <em>{item.suggestedAction}</em>}
          </span>
        )}
      </div>
      <div className="mail-row-side">
        <span className="mail-row-cat" data-category={item.category ?? 'none'}>{item.category ? CATEGORY_LABEL[item.category] : 'Sorteras'}</span>
        {status && <span className="mail-row-status">{status}</span>}
        <span className="mail-row-actions">
          {item.draft === 'proposed' && <button type="button" className="link-btn" onClick={() => onOpen(item.id, 'draft')}>Utkast</button>}
          {item.agent && <button type="button" className="link-btn" onClick={() => onOpen(item.id, 'chat')}>Chatt</button>}
          <RowMenu item={item} rules={rules} onRule={onRule} />
        </span>
      </div>
    </li>
  );
}

function RulesSection({ rules, onRule }: { rules: MailRule[]; onRule: (kind: MailRuleKind, pattern: string, on: boolean) => void }) {
  const [text, setText] = useState('');
  const groups = groupRules(rules);
  const add = (): void => {
    const pattern = normaliseSubjectPattern(text);
    if (!pattern || hasRule(rules, 'never_ai_subject', pattern)) return;
    onRule('never_ai_subject', pattern, true);
    setText('');
  };
  return (
    <section className="mail-rules" aria-label="Regler">
      <h3>Regler</h3>
      {groups.length === 0 && <p className="mail-rules-empty">Inga regler än. Använd menyn ⋯ på ett mejl, eller lägg till ord nedan.</p>}
      {groups.map((g) => (
        <div key={g.kind} className="mail-rule-group">
          <div className="mail-rule-kind">{RULE_LABEL[g.kind]}</div>
          <ul>
            {g.rules.map((r) => (
              <li key={r.id} className="mail-rule">
                <span className="mail-rule-pattern">{r.pattern}</span>
                <button type="button" className="link-btn" title="Ta bort regeln" onClick={() => onRule(r.kind, r.pattern, false)}>Ta bort</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form className="mail-rule-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input
          className="input"
          value={text}
          placeholder="Ämnesord som aldrig ska skickas till Claude"
          aria-label="Nytt ämnesord"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!normaliseSubjectPattern(text)}>Lägg till</button>
      </form>
    </section>
  );
}

interface MailListProps {
  onOpen: (mailId: number, mode: OpenMode) => void;
}

/** All recent mail with category filters, per-mail teaching (reclassify, rules) and the rules themselves. */
export function MailList({ onOpen }: MailListProps) {
  const overview = useMail();
  const [items, setItems] = useState<MailItemView[] | null>(null);
  const [rules, setRules] = useState<MailRule[]>([]);
  const [filter, setFilter] = useState<MailFilter>(DEFAULT_FILTER);
  const [error, setError] = useState('');

  const load = useCallback((): void => {
    window.cm
      .invoke('mail:list', { days: 7 })
      .then((list) => {
        setItems(list);
        setError('');
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  // Reload on mount and whenever main pushes a changed overview (new mail, triage done, handled).
  useEffect(load, [load, overview]);
  useEffect(() => {
    window.cm.invoke('mail:rules', undefined).then(setRules).catch(() => undefined);
  }, []);

  const setRule = (kind: MailRuleKind, pattern: string, on: boolean): void => {
    window.cm
      .invoke('mail:set-rule', { kind, pattern, on })
      .then(setRules)
      .catch((e: unknown) => setError(errorMessage(e)));
  };

  const counts = countByCategory(items ?? [], filter.showHandled);
  const shown = filterMail(items ?? [], filter);
  const quiet = counts.junk + counts.bulk;

  return (
    <div className="mail-list">
      <div className="mail-list-bar">
        <div className="mail-chips" role="group" aria-label="Kategori">
          <button type="button" className={filter.category === null ? 'chip-btn on' : 'chip-btn'} onClick={() => setFilter({ ...filter, category: null })}>Alla</button>
          {CATEGORY_ORDER.filter((c) => (c !== 'junk' && c !== 'bulk') || filter.showQuiet || filter.category === c).map((c) => (
            <button
              key={c}
              type="button"
              className={filter.category === c ? 'chip-btn on' : 'chip-btn'}
              data-category={c}
              disabled={counts[c] === 0 && filter.category !== c}
              onClick={() => setFilter({ ...filter, category: filter.category === c ? null : c })}
            >
              {CATEGORY_LABEL[c]} {counts[c]}
            </button>
          ))}
          <button
            type="button"
            className={filter.showQuiet ? 'chip-btn on' : 'chip-btn'}
            aria-pressed={filter.showQuiet}
            onClick={() => setFilter({ ...filter, showQuiet: !filter.showQuiet, category: filter.category === 'junk' || filter.category === 'bulk' ? null : filter.category })}
          >
            Visa skräp{quiet ? ` (${quiet})` : ''}
          </button>
          <button type="button" className={filter.showHandled ? 'chip-btn on' : 'chip-btn'} aria-pressed={filter.showHandled} onClick={() => setFilter({ ...filter, showHandled: !filter.showHandled })}>
            Hanterade
          </button>
        </div>
        <input className="input mail-search" value={filter.query} placeholder="Sök" aria-label="Sök i listan" onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
      </div>
      {error && <p className="mail-list-error">{error}</p>}
      {items === null && !error && <p className="mail-list-empty">Laddar…</p>}
      {items !== null && shown.length === 0 && (
        <p className="mail-list-empty">{items.length === 0 ? 'Inget mejl de senaste sju dagarna.' : 'Inget mejl matchar filtret.'}</p>
      )}
      <ul className="mail-rows">
        {shown.map((m) => <Row key={m.id} item={m} rules={rules} onOpen={onOpen} onRule={setRule} />)}
      </ul>
      <RulesSection rules={rules} onRule={setRule} />
    </div>
  );
}
