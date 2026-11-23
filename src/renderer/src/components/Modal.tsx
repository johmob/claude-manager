import { useEffect, useRef, type ReactNode } from 'react';

/** Open modals, innermost last: Esc closes only the topmost one. */
const openModals: object[] = [];

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** "full" nearly fills the window (work schema); default is a compact dialog. */
  size?: 'full';
}

/** Centered dialog; Esc or a click on the backdrop closes it. Modals may open on top of each other. */
export function Modal({ title, onClose, children, size }: ModalProps) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const me = {};
    openModals.push(me);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === me) close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      openModals.splice(openModals.indexOf(me), 1);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={size ? `modal ${size}` : 'modal'} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Stäng" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
