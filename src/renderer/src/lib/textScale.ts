import { useEffect } from 'react';
import { send } from './api';

const STEP = 0.05;

/**
 * Applies the text size setting to this window (all text sizes are rem) and lets Ctrl + plus/minus
 * change it and Ctrl + 0 reset it. Only the main window and popups use it; overlay and dock keep their size.
 */
export function useTextScale(scale: number | undefined): void {
  useEffect(() => {
    if (scale === undefined) return;
    document.documentElement.style.fontSize = `${16 * scale}px`;
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey) return;
      const next = e.key === '+' || e.key === '=' ? scale + STEP : e.key === '-' ? scale - STEP : e.key === '0' ? 1.1 : null;
      if (next === null) return;
      e.preventDefault();
      send('settings:update', { textScale: next });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scale]);
}
