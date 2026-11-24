import { useEffect, useState } from 'react';
import { errorMessage } from '../lib/api';
import { baseName, fileAct, openFile, useOutlook, type FileAction } from '../lib/fileShare';
import { imagePathOf, imageSrc } from '../lib/localImage';
import { isRemote } from '../lib/platform';
import { RemoteFileActions } from './FileLink';
import { Modal } from './Modal';
import '../styles/files.css';

const SHOW_IMAGE = 'cm:show-image';

interface Shown {
  src: string;
  alt: string;
}

/** Opens an image large in the window's image viewer. */
export function showImage(src: string, alt: string): void {
  window.dispatchEvent(new CustomEvent<Shown>(SHOW_IMAGE, { detail: { src, alt } }));
}

/** A local image in agent text: a preview; a click shows it large. Sits in a fixed-height frame, so nothing moves when it loads; a missing file shows a placeholder of the same size. */
export function LocalImage({ src, alt }: Shown) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="md-img-frame md-img-missing">Bilden saknas</span>;
  return (
    <span className="md-img-frame">
      <img
        className="md-img"
        src={imageSrc(src)}
        alt={alt}
        title="Klicka för att visa stort"
        loading="lazy"
        onError={() => setFailed(true)}
        onClick={() => showImage(src, alt)}
      />
    </span>
  );
}

/** What can be done with the open image: on the computer save, copy, mail, show in folder, open; on the phone download and share. */
function ImageActions({ src }: { src: string }) {
  const path = imagePathOf(src);
  const outlook = useOutlook();
  const [note, setNote] = useState<string | null>(null);
  if (!path) return null;
  if (isRemote) return <RemoteFileActions url={imageSrc(src)} name={baseName(path)} />;
  const run = (action: FileAction, done?: string) => (): void => {
    setNote(null);
    fileAct(path, action).then(
      () => setNote(done ?? null),
      (e: unknown) => setNote(errorMessage(e)),
    );
  };
  return (
    <div className="file-actions">
      <div className="file-actions-row">
        <button type="button" className="btn" onClick={run('save-as')}>Spara som…</button>
        <button type="button" className="btn" onClick={run('copy', 'Bilden ligger på urklipp.')}>Kopiera bild</button>
        {outlook && <button type="button" className="btn" onClick={run('mail')}>Nytt mejl i Outlook</button>}
        <button type="button" className="btn" onClick={run('show')}>Visa i mapp</button>
        <button type="button" className="btn" onClick={() => openFile(path)}>Öppna</button>
      </div>
      {note && <div className="file-note">{note}</div>}
    </div>
  );
}

/** The window's image viewer: shows an image large in a modal when one is opened. */
export function ImageViewer() {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    const onShow = (e: Event): void => setShown((e as CustomEvent<Shown>).detail);
    window.addEventListener(SHOW_IMAGE, onShow);
    return () => window.removeEventListener(SHOW_IMAGE, onShow);
  }, []);
  if (!shown) return null;
  return (
    <Modal title={shown.alt || 'Bild'} onClose={() => setShown(null)} size="full">
      <ImageActions src={shown.src} />
      <img className="image-view" src={imageSrc(shown.src)} alt={shown.alt} />
    </Modal>
  );
}
