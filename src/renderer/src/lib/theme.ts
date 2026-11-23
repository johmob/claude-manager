import { useEffect } from 'react';
import type { ThemeChoice } from '../../../shared/contracts';

/** Puts the chosen theme on this window's root element; the stylesheet does the rest. */
export function useTheme(theme: ThemeChoice | undefined): void {
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);
}
