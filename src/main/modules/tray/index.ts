// tray: the system-tray icon that keeps the app reachable while minimised there.
import { Menu, Tray } from 'electron';
import type { NativeImage } from 'electron';

export interface AppTray {
  /** Shows how many sessions wait for an answer in the tooltip. */
  setWaiting(count: number): void;
  setLaunchAtLogin(on: boolean): void;
  destroy(): void;
}

export interface TrayOptions {
  icon: NativeImage;
  onOpen: () => void;
  onQuit: () => void;
  launchAtLogin: boolean;
  onLaunchAtLogin: (on: boolean) => void;
}

export function createTray(opts: TrayOptions): AppTray {
  const tray = new Tray(opts.icon.resize({ width: 16, height: 16 }));
  const buildMenu = (launchAtLogin: boolean): void =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Öppna Claude Manager', click: opts.onOpen },
        { type: 'separator' },
        { label: 'Starta med Windows', type: 'checkbox', checked: launchAtLogin, click: (item) => opts.onLaunchAtLogin(item.checked) },
        { type: 'separator' },
        { label: 'Avsluta', click: opts.onQuit },
      ]),
    );
  buildMenu(opts.launchAtLogin);
  tray.on('click', opts.onOpen);
  tray.setToolTip('Claude Manager');

  return {
    setWaiting: (count) => tray.setToolTip(count ? `Claude Manager – ${count} väntar på svar` : 'Claude Manager'),
    setLaunchAtLogin: buildMenu,
    destroy: () => tray.destroy(),
  };
}
