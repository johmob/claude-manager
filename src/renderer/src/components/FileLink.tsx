import { useState, type ReactNode } from 'react';
import { send } from '../lib/api';
import { fileAct, openFile, useOutlook, type FileAction } from '../lib/fileShare';
import { errorMessage } from '../lib/api';
import { filePathOf } from '../lib/localImage';
import { useContextMenu, type MenuItem } from './ContextMenu';
import { Modal } from './Modal';
import '../styles/files.css';

/** The desktop actions on a local file, as context-menu items. Mail is offered only when classic Outlook exists. */
export function useFileMenuItems(path: string | null, onError: (message: string) => void): MenuItem[] {
  const outlook = useOutlook();
  if (!path) return [];
  const act = (action: FileAction) => (): void => void fileAct(path, action).catch((e: unknown) => onError(errorMessage(e)));
  return [
    { label: 'Öppna', onSelect: () => openFile(path) },
    { label: 'Visa i mapp', onSelect: act('show') },
    { label: 'Spara som…', onSelect: act('save-as') },
    { label: 'Kopiera filen', onSelect: act('copy') },
    ...(outlook ? [{ label: 'Nytt mejl i Outlook', onSelect: act('mail') }] : []),
  ];
}

/**
 * A link to a local file in agent text. Desktop: a click opens it, a right-click gives the file actions
 * (open, show in folder, save as, copy, mail).
 * With `onOpen` (a local image link) the click does that instead; the right-click menu is the same.
 */
export function FileLink({ href, path: given, onOpen, children }: { href: string; path?: string | null; onOpen?: () => void; children?: ReactNode }) {
  const path = given ?? filePathOf(href);
  const [error, setError] = useState<string | null>(null);
  const menu = useContextMenu(useFileMenuItems(path, setError));

  return (
    <>
      <a
        className="md-link"
        href={href}
        title={onOpen ? undefined : (path ?? href)}
        onClick={(e) => {
          e.preventDefault();
          if (onOpen) onOpen();
          else send('shell:open', { target: href });
        }}
        onContextMenu={path ? menu.open : undefined}
      >
        {children}
      </a>
      {menu.menu}
      {error && (
        <Modal title="Filen kunde inte hanteras" onClose={() => setError(null)}>
          <p>{error}</p>
        </Modal>
      )}
    </>
  );
}
