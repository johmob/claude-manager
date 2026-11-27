import { useMemo, useState } from 'react';
import type { MailAddress, MailAttachmentInfo, MailCategory, MailItemView, MailMessageView } from '../../../../shared/contracts';
import { errorMessage, send } from '../../lib/api';
import { mailLinkItems, mailSrcdoc, remoteImageCount, textLinks, textSrcdoc, type MailLink } from '../../lib/mailHtml';
import '../../styles/mail-case.css';
import { useContextMenu } from '../ContextMenu';

const CATEGORY_LABEL: Record<MailCategory, string> = {
  junk: 'Skräp',
  bulk: 'Utskick',
  info: 'Information',
  reply: 'Svar',
  action: 'Åtgärd',
  meeting: 'Möte',
  private: 'Ej bedömt',
};

/** "Anna Exempel <anna@example.com>" when there is a name, otherwise just the address. */
export function addressText(a: MailAddress): string {
  return a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function sizeText(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} kB`;
  return `${bytes} B`;
}

/** Recipients: the first few by name, the rest behind a count; the whole list is in the tooltip. */
function Recipients({ label, list }: { label: string; list: MailAddress[] }) {
  const [all, setAll] = useState(false);
  if (list.length === 0) return null;
  const shown = all ? list : list.slice(0, 3);
  return (
    <div className="mm-rcpt">
      <span className="mm-rcpt-label">{label}</span>
      <span className="mm-rcpt-list" title={list.map(addressText).join('\n')}>
        {shown.map((a) => a.name || a.address).join(', ')}
        {!all && list.length > 3 && (
          <button type="button" className="link-btn" onClick={() => setAll(true)}> +{list.length - 3} till</button>
        )}
      </span>
    </div>
  );
}

/** An attachment: a click opens it (saved into the thread folder first), a right-click offers save and show. */
function AttachmentChip({ mailId, attachment, onError }: { mailId: number; attachment: MailAttachmentInfo; onError: (m: string) => void }) {
  const act = (action: 'open' | 'save-as' | 'show'): void => {
    window.cm.invoke('mail:attachment', { mailId, index: attachment.index, action }).catch((e: unknown) => onError(errorMessage(e)));
  };
  const menu = useContextMenu([
    { label: 'Öppna', onSelect: () => act('open') },
    { label: 'Spara som…', onSelect: () => act('save-as') },
    { label: 'Visa i mapp', onSelect: () => act('show') },
  ]);
  return (
    <>
      <button type="button" className="mm-att" title="Öppna (högerklick: spara eller visa i mapp)" onClick={() => act('open')} onContextMenu={menu.open}>
        <span className="mm-att-name">{attachment.name}</span>
        <span className="mm-att-size">{sizeText(attachment.size)}</span>
      </button>
      {menu.menu}
    </>
  );
}

/** Every link of the mail with its real address; nothing in the mail itself can navigate. */
function LinkList({ links }: { links: MailLink[] }) {
  if (links.length === 0) return null;
  return (
    <details className="mm-links">
      <summary>Länkar i mejlet ({links.length})</summary>
      <div className="mm-links-note">Det här är de verkliga adresserna. Klicka bara på det du känner igen.</div>
      {links.map((l) => (
        <div key={l.url} className="mm-link" data-mismatch={l.mismatch || undefined}>
          {l.text && l.text !== l.url && <span className="mm-link-text">{l.text}</span>}
          <button type="button" className="link-btn mm-link-url" title="Öppna i webbläsaren" onClick={() => send('shell:open', { target: l.url })}>{l.url}</button>
          {l.mismatch && <span className="mm-link-warn">Texten visar en annan adress än länken går till</span>}
        </div>
      ))}
    </details>
  );
}

/** An earlier mail of the thread, folded; opening it shows its text in place. */
function ThreadRow({ item }: { item: MailItemView }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && text === null) {
      window.cm
        .invoke('mail:message', { mailId: item.id, html: false })
        .then((v) => setText(v?.bodyText ?? ''))
        .catch((e: unknown) => setError(errorMessage(e)));
    }
  };
  return (
    <div className="mm-thread-row" data-open={open || undefined}>
      <button type="button" className="mm-thread-head" aria-expanded={open} onClick={toggle}>
        <span className="mm-thread-caret">{open ? '▾' : '▸'}</span>
        <span className="mm-thread-from">{item.from.name || item.from.address}</span>
        <span className="mm-thread-when">{formatWhen(item.at)}</span>
      </button>
      {open && (
        <div className="mm-thread-body">
          {error ? <span className="mm-error">{error}</span> : text === null ? 'Hämtar…' : text.trim() || '(Tomt)'}
        </div>
      )}
    </div>
  );
}

/**
 * The original mail, in the app and never in Outlook. HTML mail is shown in a sandboxed frame (no scripts, no
 * remote content, nothing can navigate); a phishing suspect opens as plain text. Links are listed with their
 * real addresses, earlier mails of the thread open in place.
 */
export function MailMessage({ view }: { view: MailMessageView }) {
  const { item } = view;
  const hasHtml = !!view.bodyHtml?.trim();
  const [asText, setAsText] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  // A mail the sorter flagged as phishing starts as text; the user can still look at the HTML.
  const text = asText ?? (!hasHtml || item.phishing);
  const srcDoc = useMemo(() => (text ? textSrcdoc(view.bodyText) : mailSrcdoc(view.bodyHtml ?? '')), [text, view.bodyText, view.bodyHtml]);
  const links = useMemo<MailLink[]>(
    () => (text || !view.bodyHtml ? textLinks(view.bodyText).map((url) => ({ url, text: '', mismatch: false })) : mailLinkItems(view.bodyHtml)),
    [text, view.bodyText, view.bodyHtml],
  );
  const blocked = useMemo(() => (view.bodyHtml && !text ? remoteImageCount(view.bodyHtml) : 0), [text, view.bodyHtml]);
  const files = view.attachments.filter((a) => !a.inline);
  const earlier = view.thread.filter((t) => t.id !== item.id);

  return (
    <div className="mm">
      <div className="mm-head">
        <div className="mm-subject">{item.subject || '(Inget ämne)'}</div>
        <div className="mm-from-row">
          <span className="mm-from" title={item.from.address}>{item.from.name || item.from.address}</span>
          {item.from.name && <span className="mm-from-addr">{item.from.address}</span>}
          <span className="mm-when">{formatWhen(item.at)}</span>
        </div>
        <Recipients label="Till" list={view.to} />
        <Recipients label="Kopia" list={view.cc} />
        {(item.category || item.summary) && (
          <div className="mm-triage">
            {item.category && <span className="mm-cat" data-cat={item.category}>{CATEGORY_LABEL[item.category]}</span>}
            <span className="mm-triage-text">{[item.summary, item.reason].filter(Boolean).join(' · ')}</span>
          </div>
        )}
        {item.phishing && (
          <div className="mm-phish" role="alert">
            Möjligt nätfiske. Öppna inga länkar eller filer och svara inte med uppgifter förrän du är säker på avsändaren.
          </div>
        )}
        {files.length > 0 && (
          <div className="mm-atts">
            {files.map((a) => <AttachmentChip key={a.index} mailId={item.id} attachment={a} onError={setError} />)}
          </div>
        )}
        {error && <div className="mm-error">{error}</div>}
      </div>

      {hasHtml && (
        <div className="mm-view-switch" role="group" aria-label="Visning">
          <button type="button" data-on={!text || undefined} onClick={() => setAsText(false)}>Som skickat</button>
          <button type="button" data-on={text || undefined} onClick={() => setAsText(true)}>Text</button>
          {blocked > 0 && <span className="mm-blocked" title="Bilder från webben hämtas inte, så att avsändaren inte ser att du läst mejlet">{blocked} {blocked === 1 ? 'bild' : 'bilder'} från webben blockerade</span>}
        </div>
      )}
      <iframe className="mm-frame" title="Mejlets innehåll" sandbox="" srcDoc={srcDoc} />
      {!hasHtml && !view.bodyText.trim() && <div className="mm-empty">Mejlet har ingen text.</div>}
      <LinkList links={links} />
      {earlier.length > 0 && (
        <div className="mm-thread">
          <div className="mm-thread-title">Tidigare i tråden ({earlier.length})</div>
          {earlier.map((t) => <ThreadRow key={t.id} item={t} />)}
        </div>
      )}
    </div>
  );
}
