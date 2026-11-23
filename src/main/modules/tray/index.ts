// tray: the system-tray icon that keeps the app reachable while minimised there.
import { Menu, Tray } from 'electron';
import type { NativeImage } from 'electron';

export interface AppTray {
  /** Shows how many sessions wait for an answer in the tooltip. */
  setWaiting(count: number): void;
  destroy(): void;
}

export function createTray(opts: { icon: NativeImage; onOpen: () => void; onQuit: () => void }): AppTray {
  const tray = new Tray(opts.icon.resize({ width: 16, height: 16 }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Öppna Claude Manager', click: opts.onOpen },
      { type: 'separator' },
      { label: 'Avsluta', click: opts.onQuit },
    ]),
  );
  tray.on('click', opts.onOpen);
  tray.setToolTip('Claude Manager');

  return {
    setWaiting: (count) => tray.setToolTip(count ? `Claude Manager – ${count} väntar på svar` : 'Claude Manager'),
    destroy: () => tray.destroy(),
  };
}
