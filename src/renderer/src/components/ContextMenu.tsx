import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
}

interface OpenMenu {
  x: number;
  y: number;
  items: MenuItem[];
}

/**
 * A right-click menu. `open` is the element's onContextMenu handler; `menu` must be rendered somewhere
 * in the component. The menu closes on a choice, a click elsewhere, Escape, scrolling or resizing.
 */
export function useContextMenu(items: MenuItem[]): { open: (e: MouseEvent) => void; menu: ReactNode } {
  const [shown, setShown] = useState<OpenMenu | null>(null);

  useEffect(() => {
    if (!shown) return;
    const close = (): void => setShown(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [shown]);

  const open = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setShown({ x: e.clientX, y: e.clientY, items });
  };

  const menu = shown && (
    <div className="context-menu" style={{ left: shown.x, top: shown.y }} onMouseDown={(e) => e.stopPropagation()} role="menu">
      {shown.items.map((item) => (
        <button
          type="button"
          role="menuitem"
          key={item.label}
          onClick={(e) => {
            e.stopPropagation();
            setShown(null);
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  return { open, menu };
}
