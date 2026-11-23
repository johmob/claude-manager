// window-manager: creates and positions the app's three windows (main, dock, overlay).
// Knows nothing about sessions beyond how many cards the dock and overlay must fit.
import { BrowserWindow, screen } from 'electron';
import type { NativeImage, Rectangle } from 'electron';
import type { DockEdge, IpcEventChannel, IpcEventMap, IpcInvokeMap } from '../../../shared/contracts';

type SnapMode = IpcInvokeMap['window:snap']['req']['mode'];

export interface WindowManagerOptions {
  preloadPath: string;
  /** Dev server URL (electron-vite dev), or undefined in a built app. */
  rendererUrl: string | undefined;
  /** Built renderer index.html. */
  rendererFile: string;
  icon: NativeImage;
  /** Called when the user tries to close the main window; call `event.preventDefault()` to keep it. */
  onMainClose: (event: Electron.Event) => void;
}

export interface WindowManager {
  showMain(): void;
  hideMain(): void;
  /** Lets the next main-window close go through (used when quitting). */
  allowMainClose(): void;
  setDock(visible: boolean, edge: DockEdge, count: number): void;
  setOverlay(visible: boolean, count: number): void;
  setOverlayInteractive(interactive: boolean): void;
  /** Left or right half, maximised, or back from maximised. */
  snap(mode: SnapMode): void;
  /** Maximises the main window when its content is narrower than `width`; true when it did. */
  ensureWidth(width: number): boolean;
  flash(on: boolean): void;
  send<K extends IpcEventChannel>(channel: K, payload: IpcEventMap[K]): void;
  destroyAll(): void;
}

const DOCK_CARD = { width: 204, height: 60, gap: 8, pad: 8 };
const DOCK_VERTICAL_WIDTH = 220;
const DOCK_HORIZONTAL_HEIGHT = 76;
const OVERLAY_CELL = 60;
const OVERLAY_HEIGHT = 44;
const EDGE_MARGIN = 8;

type Route = 'main' | 'dock' | 'overlay';

export function createWindowManager(opts: WindowManagerOptions): WindowManager {
  let closeAllowed = false;
  const main = createWindow('main', {
    width: 1320,
    height: 840,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Claude Manager',
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    icon: opts.icon,
  });
  main.once('ready-to-show', () => main.show());
  main.on('close', (event) => {
    if (!closeAllowed) opts.onMainClose(event);
  });

  let dock: BrowserWindow | null = null;
  let overlay: BrowserWindow | null = null;
  let overlayInteractive = false;

  function createWindow(route: Route, options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
    const win = new BrowserWindow({
      ...options,
      webPreferences: { preload: opts.preloadPath, sandbox: true, contextIsolation: true },
    });
    if (opts.rendererUrl) void win.loadURL(`${opts.rendererUrl}#${route}`);
    else void win.loadFile(opts.rendererFile, { hash: route });
    return win;
  }

  function floatingWindow(route: Route): BrowserWindow {
    const win = createWindow(route, {
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true);
    return win;
  }

  function place(win: BrowserWindow, bounds: Rectangle): void {
    win.setBounds(bounds);
    if (!win.isVisible()) win.showInactive();
  }

  function setDock(visible: boolean, edge: DockEdge, count: number): void {
    if (!visible || count === 0) {
      dock?.hide();
      return;
    }
    dock ??= floatingWindow('dock');
    const area = screen.getPrimaryDisplay().workArea;
    const length = DOCK_CARD.pad * 2 + count * DOCK_CARD.height + (count - 1) * DOCK_CARD.gap;
    const across = DOCK_CARD.pad * 2 + count * DOCK_CARD.width + (count - 1) * DOCK_CARD.gap;
    if (edge === 'right') {
      const height = Math.min(length, area.height - EDGE_MARGIN * 2);
      place(dock, { x: area.x + area.width - DOCK_VERTICAL_WIDTH - EDGE_MARGIN, y: area.y + Math.round((area.height - height) / 2), width: DOCK_VERTICAL_WIDTH, height });
      return;
    }
    const width = Math.min(across, area.width - EDGE_MARGIN * 2);
    const y = edge === 'bottom' ? area.y + area.height - DOCK_HORIZONTAL_HEIGHT - EDGE_MARGIN : area.y + Math.round((area.height - DOCK_HORIZONTAL_HEIGHT) / 2);
    place(dock, { x: area.x + Math.round((area.width - width) / 2), y, width, height: DOCK_HORIZONTAL_HEIGHT });
  }

  function setOverlay(visible: boolean, count: number): void {
    if (!visible || count === 0) {
      overlay?.hide();
      return;
    }
    if (!overlay) {
      overlay = floatingWindow('overlay');
      overlay.setIgnoreMouseEvents(true, { forward: true });
    }
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(count * OVERLAY_CELL + 16, area.width);
    place(overlay, { x: area.x + Math.round((area.width - width) / 2), y: area.y + 2, width, height: OVERLAY_HEIGHT });
  }

  function setOverlayInteractive(interactive: boolean): void {
    if (!overlay || interactive === overlayInteractive) return;
    overlayInteractive = interactive;
    if (interactive) overlay.setIgnoreMouseEvents(false);
    else overlay.setIgnoreMouseEvents(true, { forward: true });
  }

  function snap(mode: SnapMode): void {
    if (mode === 'full') {
      main.maximize();
      return;
    }
    if (main.isMaximized()) main.unmaximize();
    if (mode === 'restore') return;
    const area = screen.getDisplayMatching(main.getBounds()).workArea;
    const half = Math.floor(area.width / 2);
    main.setBounds({ x: mode === 'left' ? area.x : area.x + half, y: area.y, width: half, height: area.height });
  }

  function ensureWidth(width: number): boolean {
    if (main.isMaximized() || main.getContentSize()[0]! >= width) return false;
    main.maximize();
    return true;
  }

  function showMain(): void {
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }

  return {
    showMain,
    hideMain: () => main.hide(),
    allowMainClose: () => void (closeAllowed = true),
    setDock,
    setOverlay,
    setOverlayInteractive,
    snap,
    ensureWidth,
    flash: (on) => main.flashFrame(on && !main.isFocused()),
    send: (channel, payload) => {
      for (const win of [main, dock, overlay]) {
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
      }
    },
    destroyAll: () => {
      for (const win of [dock, overlay, main]) if (win && !win.isDestroyed()) win.destroy();
    },
  };
}
