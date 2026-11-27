import { Mail } from 'lucide-react';
import '../../styles/mail-overlay.css';
import type { MailOverview } from '../../../../shared/contracts';
import { send } from '../../lib/api';
import { sourceHint } from './mailRows';

/** The Mejl cell of the overlay: icon, count of mail that needs the user, a ring while mail is being sorted. Click opens the list. */
export function MailCell({ mail, open, onHover }: { mail: MailOverview; open: boolean; onHover: () => void }) {
  const hint = sourceHint(mail.source);
  const count = mail.attention.length;
  const title = hint.state === 'ok' ? `Mejl · ${count ? `${count} att hantera` : 'inget att hantera'} · Klicka: visa alla` : hint.title;
  return (
    <div
      className="ov-cell ov-mail"
      data-state={hint.state}
      data-open={open ? 'true' : undefined}
      title={title}
      onMouseEnter={onHover}
      onClick={() => send('popup:open', { kind: 'mail', id: 'list', mode: 'list' })}
    >
      <span className="ov-icon ov-mail-icon">
        {mail.triaging > 0 && <span className="ov-mail-spin" aria-hidden />}
        <Mail className="icon" aria-hidden />
        {count > 0 && <span className="ov-mark ov-mail-count">{count > 99 ? '99+' : count}</span>}
      </span>
      <span className="ov-name">Mejl</span>
    </div>
  );
}
