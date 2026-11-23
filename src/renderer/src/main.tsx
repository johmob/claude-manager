import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { MainWindow } from './windows/MainWindow';
import { DockWindow } from './windows/DockWindow';
import { OverlayWindow } from './windows/OverlayWindow';
import { SchemaWindow } from './windows/SchemaWindow';

function pickWindow(): { name: string; element: ReactElement } {
  switch (location.hash) {
    case '#dock':
      return { name: 'dock', element: <DockWindow /> };
    case '#overlay':
      return { name: 'overlay', element: <OverlayWindow /> };
    case '#schema':
      return { name: 'schema', element: <SchemaWindow /> };
    default:
      return { name: 'main', element: <MainWindow /> };
  }
}

const win = pickWindow();
document.documentElement.dataset.window = win.name;
const container = document.getElementById('root');
if (container) createRoot(container).render(<StrictMode>{win.element}</StrictMode>);
