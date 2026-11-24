import { useEffect, useState, type ReactNode } from 'react';
import { send } from '../lib/api';
import { baseName, canShareFiles, download, fetchShareable, fileAct, openFile, shareFile, useOutlook, type FileAction } from '../lib/fileShare';
import { errorMessage } from '../lib/api';
import { filePathOf, remoteFileUrl } from '../lib/localImage';
import { isRemote } from '../lib/platform';
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
 * Ladda ned and Dela for a file fetched from the computer (the phone). The file is fetched when this
 * shows, so Dela still has the tap's user activation when it is pressed.
 */
export function RemoteFileActions({ url, name }: { url: string; name: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFile(null);
    setError(null);
    fetchShareable(url, name).then(
      (f) => alive && setFile(f),
      (e: unknown) => alive && setError(errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, [url, name]);

  const save = (): void => {
    if (!file) return;
    const href = URL.createObjectURL(file);
    download(href, name);
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };
  const share = (): void => {
    if (!file) return;
    void shareFile(file).then((ok) => setNote(ok ? null : 'Telefonen kunde inte dela den här filen.'));
  };

  return (
    <div className="file-actions">
      <div className="file-actions-row">
        <button type="button" className="btn primary" disabled={!file} onClick={save}>Ladda ned</button>
        {canShareFiles() && <button type="button" className="btn" disabled={!file} onClick={share}>Dela</button>}
      </div>
      {!file && !error && <div className="file-note">Hämtar filen…</div>}
      {(error ?? note) && <div className="file-note" data-error>{error ?? note}</div>}
    </div>
  );
}

/**
 * A link to a local file in agent text. Desktop: a click opens it, a right-click gives the file actions
 * (open, show in folder, save as, copy, mail). Phone: a tap opens a sheet with Ladda ned and Dela.
 * With `onOpen` (a local image link) the click does that instead; the right-click menu is the same.
 */
export function FileLink({ href, path: given, onOpen, children }: { href: string; path?: string | null; onOpen?: () => void; children?: ReactNode }) {
  const path = given ?? filePathOf(href);
  const [sheet, setSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menu = useContextMenu(useFileMenuItems(isRemote ? null : path, setError));

  return (
    <>
      <a
        className="md-link"
        href={href}
        title={onOpen ? undefined : (path ?? href)}
        onClick={(e) => {
          e.preventDefault();
          if (onOpen) onOpen();
          else if (isRemote) setSheet(true);
          else send('shell:open', { target: href });
        }}
        onContextMenu={isRemote || !path ? undefined : menu.open}
      >
        {children}
      </a>
      {menu.menu}
      {error && (
        <Modal title="Filen kunde inte hanteras" onClose={() => setError(null)}>
          <p>{error}</p>
        </Modal>
      )}
      {sheet && path && (
        <Modal title={baseName(path)} onClose={() => setSheet(false)}>
          <RemoteFileActions url={remoteFileUrl(path)} name={baseName(path)} />
        </Modal>
      )}
    </>
  );
}
