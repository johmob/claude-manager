import './lib/remoteBridge';
import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import './mobile.css';
import { isRemote } from './lib/platform';
import { MobileWindow } from './windows/MobileWindow';
import { MainWindow } from './windows/MainWindow';
import { DockWindow } from './windows/DockWindow';
import { OverlayWindow } from './windows/OverlayWindow';
import { PopupWindow } from './windows/PopupWindow';

function pickWindow(): { name: string; element: ReactElement } {
  // On the phone (the UI served through the remote host) there is only the mobile layout.
  if (isRemote) return { name: 'mobile', element: <MobileWindow /> };
  switch (location.hash) {
    case '#dock':
      return { name: 'dock', element: <DockWindow /> };
    case '#overlay':
      return { name: 'overlay', element: <OverlayWindow /> };
    case '#popup':
      return { name: 'popup', element: <PopupWindow /> };
    default:
      return { name: 'main', element: <MainWindow /> };
  }
}

const win = pickWindow();
document.documentElement.dataset.window = win.name;
const container = document.getElementById('root');
if (container) createRoot(container).render(<StrictMode>{win.element}</StrictMode>);
