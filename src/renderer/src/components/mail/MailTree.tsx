import type { MouseEvent } from 'react';
import '../../styles/mail-overlay.css';
import type { MailItemView, MailOverview } from '../../../../shared/contracts';
import { send } from '../../lib/api';
import { agentActionsDisabled, draftLabel, footerText, rowMark } from './mailRows';

type Act = 'drop' | 'reply' | 'agent';

function act(e: MouseEvent, mailId: number, action: Act): void {
  e.stopPropagation();
  send('mail:act', { mailId, action });
}

function MailRow({ item }: { item: MailItemView }) {
  const mark = rowMark(item);
  const draft = draftLabel(item);
  const locked = agentActionsDisabled(item);
  const lockedTitle = 'Utesluten från Claude enligt din regel';
  return (
    <li
      className="mt-row"
      data-tone={mark.tone}
      onClick={() => send('popup:open', { kind: 'mail', id: String(item.id), mode: 'mail' })}
      title="Klicka för originalmejlet"
    >
      <div className="mt-head">
        <strong className="mt-from" title={item.from.address}>{item.from.name || item.from.address}</strong>
        {mark.label && <span className="mt-pill" data-tone={mark.tone} title={mark.title}>{mark.label}</span>}
      </div>
      <div className="mt-summary" title={item.subject}>{item.summary || item.subject}</div>
      {(item.phishing || draft) && (
        <div className="mt-flags">
          {item.phishing && <span className="mt-phish">Misstänkt nätfiske, var försiktig</span>}
          {draft && <span className="mt-draft" data-draft={item.draft ?? 'agent'}>{draft}</span>}
        </div>
      )}
      <div className="mt-actions">
        <button type="button" className="btn small" title="Markera som läst och gå vidare" onClick={(e) => act(e, item.id, 'drop')}>Släpp</button>
        <button type="button" className="btn small" disabled={locked} title={locked ? lockedTitle : 'Agenten skriver ett svarsutkast åt dig'} onClick={(e) => act(e, item.id, 'reply')}>Svara åt mig</button>
        <button type="button" className="btn small" disabled={locked} title={locked ? lockedTitle : 'Öppna mejlet med en agent att prata igenom det med'} onClick={(e) => act(e, item.id, 'agent')}>Ta det med agenten</button>
      </div>
    </li>
  );
}

/** The tree that folds out under the Mejl cell: one row per mail that needs the user. */
export function MailTree({ mail }: { mail: MailOverview }) {
  const footer = footerText(mail.counts);
  return (
    <div className="mail-tree">
      {mail.attention.length ? (
        <ul className="mt-list">
          {mail.attention.map((item) => <MailRow key={item.id} item={item} />)}
        </ul>
      ) : (
        <div className="mt-empty">Inget att hantera</div>
      )}
      <div className="mt-foot">
        <span className="muted">{footer}{mail.triaging > 0 && `${footer ? ' · ' : ''}${mail.triaging} bedöms`}</span>
        <button type="button" className="btn small" onClick={() => send('popup:open', { kind: 'mail', id: 'list', mode: 'list' })}>Visa alla</button>
      </div>
    </div>
  );
}
