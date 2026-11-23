import { useEffect, useState } from 'react';
import { Modal } from './Modal';

const SHOW_IMAGE = 'cm:show-image';

interface Shown {
  src: string;
  alt: string;
}

/** Opens an image large in the window's image viewer. */
export function showImage(src: string, alt: string): void {
  window.dispatchEvent(new CustomEvent<Shown>(SHOW_IMAGE, { detail: { src, alt } }));
}

/** A local image in agent text: a preview; a double-click shows it large. Hidden when the file cannot be read. */
export function LocalImage({ src, alt }: Shown) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className="md-img"
      src={src}
      alt={alt}
      title="Dubbelklicka för att visa stort"
      loading="lazy"
      onError={() => setFailed(true)}
      onDoubleClick={() => showImage(src, alt)}
    />
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
      <img className="image-view" src={shown.src} alt={shown.alt} />
    </Modal>
  );
}
