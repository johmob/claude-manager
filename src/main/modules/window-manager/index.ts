// window-manager: creates and positions the app's windows (main, dock, overlay, and the popup over the screen).
// Knows nothing about sessions beyond how many cards the dock and overlay must fit.
import { BrowserWindow, Menu, screen } from 'electron';
import type { NativeImage, Rectangle } from 'electron';
import type { DockEdge, IpcEventChannel, IpcEventMap, IpcInvokeMap, OverlayAnchor, PopupView, ThemeChoice } from '../../../shared/contracts';

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
  /** Keep the main window hidden at start (e.g. started with Windows); the tray opens it. */
  startHidden?: boolean;
  /**
   * A test instance: every window renders off screen (so it can still be driven and captured), never takes
   * focus and stays out of the taskbar, so it never gets in the user's way.
   */
  offscreen?: boolean;
  /** Where the user last dragged the overlay; null or absent: centred at the top. */
  overlayAnchor?: OverlayAnchor | null;
  /** The user dragged the overlay to a new place (null: back to the default). */
  onOverlayMoved?: (anchor: OverlayAnchor | null) => void;
}

export interface WindowManager {
  showMain(): void;
  hideMain(): void;
  /** Lets the next main-window close go through (used when quitting). */
  allowMainClose(): void;
  setDock(visible: boolean, edge: DockEdge, count: number): void;
  setOverlay(visible: boolean, count: number): void;
  /** Shows or hides the detail area under the overlay icons. */
  setOverlayDetail(open: boolean, wide?: boolean): void;
  /** Colours the window buttons in the top bar to match the theme. */
  setTheme(theme: ThemeChoice): void;
  /** Lets the overlay take keyboard focus (for its quick chat), or gives it back. */
  setOverlayFocus(focus: boolean): void;
  setOverlayInteractive(interactive: boolean): void;
  /** Moves the overlay with the mouse while its background is held; "end" keeps the place, "reset" goes back to the middle. */
  dragOverlay(phase: 'start' | 'end' | 'reset'): void;
  /** Shows a session's work schema or questions in a transparent window over the primary screen, focused, without the main window. */
  openPopup(view: PopupView): void;
  closePopup(): void;
  /** What the popup shows, or null. */
  popupView(): PopupView | null;
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
const OVERLAY_CELL = 82;
const OVERLAY_USAGE_WIDTH = 180;
const OVERLAY_HEIGHT = 112;
const OVERLAY_DETAIL_HEIGHT = 280;
const OVERLAY_DETAIL_WIDTH = 284;
const OVERLAY_CHAT_HEIGHT = 440;
const OVERLAY_CHAT_WIDTH = 430;
const EDGE_MARGIN = 8;
/** How often the dock and overlay are lifted back to the top. */
const KEEP_ON_TOP_MS = 3000;
/** Height of the app's top bar, where Windows draws the window buttons; matches .topbar in the stylesheet. */
const TITLE_BAR_HEIGHT = 52;
const TITLE_BAR: Record<ThemeChoice, { color: string; symbolColor: string }> = {
  night: { color: '#090b13', symbolColor: '#f6f8fc' },
  standard: { color: '#161920', symbolColor: '#e6e8ee' },
};

type Route = 'main' | 'dock' | 'overlay' | 'popup';

/** How far a test instance's windows sit to the left of every screen. */
const OFFSCREEN_X = -40000;

export function createWindowManager(opts: WindowManagerOptions): WindowManager {
  // No application menu: its default zoom shortcuts would zoom every window of the app at once (Chromium
  // zooms per origin), overlay and dock included. Text size is the app's own setting instead.
  Menu.setApplicationMenu(null);
  let closeAllowed = false;
  const hidden = opts.offscreen === true;
  /** Where a window goes: where asked, or off screen in a test instance. */
  const at = (b: Rectangle): Rectangle => (hidden ? { ...b, x: b.x + OFFSCREEN_X } : b);
  /** Shows a window, focused if asked; a test instance's windows show without focus. */
  const reveal = (win: BrowserWindow, focus: boolean): void => {
    if (hidden) return void win.showInactive();
    win.show();
    if (focus) win.focus();
  };
  const main = createWindow('main', {
    width: 1320,
    height: 840,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Claude Manager',
    skipTaskbar: hidden,
    backgroundColor: '#05060b',
    autoHideMenuBar: true,
    icon: opts.icon,
    // No Windows title bar: the window buttons are drawn by Windows inside the app's own top bar.
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLE_BAR.night, height: TITLE_BAR_HEIGHT },
  });
  main.once('ready-to-show', () => {
    if (hidden) main.setBounds(at(main.getBounds()));
    if (!opts.startHidden) reveal(main, false);
  });
  main.on('close', (event) => {
    if (!closeAllowed) opts.onMainClose(event);
  });

  let dock: BrowserWindow | null = null;
  let overlay: BrowserWindow | null = null;
  let overlayInteractive = false;
  let overlayDetail = false;
  let overlayWide = false;
  let overlayCount = 0;
  let overlayAnchor: OverlayAnchor | null = opts.overlayAnchor ?? null;
  let dragTimer: NodeJS.Timeout | null = null;
  let popup: BrowserWindow | null = null;
  let popupShows: PopupView | null = null;

  function createWindow(route: Route, options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
    const win = new BrowserWindow({
      ...options,
      webPreferences: { preload: opts.preloadPath, sandbox: true, contextIsolation: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
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
    // Windows can drop "always on top" (after sleep, display changes) or put other topmost windows in
    // front: set it again at once, and lift the window back to the top every few seconds while shown.
    win.on('always-on-top-changed', (_event, onTop) => {
      if (!onTop && !win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver');
    });
    const lift = setInterval(() => {
      if (win.isDestroyed()) return clearInterval(lift);
      if (!win.isVisible()) return;
      if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
    }, KEEP_ON_TOP_MS);
    win.on('closed', () => clearInterval(lift));
    return win;
  }

  function place(win: BrowserWindow, bounds: Rectangle): void {
    win.setBounds(at(bounds));
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
    overlayCount = count;
    // Centred at the top, or where the user dragged it (on the screen that point is on).
    const area = overlayAnchor ? screen.getDisplayNearestPoint({ x: Math.round(overlayAnchor.centerX), y: Math.round(overlayAnchor.top) }).workArea : screen.getPrimaryDisplay().workArea;
    const row = OVERLAY_USAGE_WIDTH + count * OVERLAY_CELL + 16;
    const detailWidth = overlayWide ? OVERLAY_CHAT_WIDTH : OVERLAY_DETAIL_WIDTH;
    const width = Math.min(overlayDetail ? Math.max(row, detailWidth) : row, area.width);
    const height = OVERLAY_HEIGHT + (overlayDetail ? (overlayWide ? OVERLAY_CHAT_HEIGHT : OVERLAY_DETAIL_HEIGHT) : 0);
    const centerX = overlayAnchor?.centerX ?? area.x + area.width / 2;
    const x = Math.min(Math.max(Math.round(centerX - width / 2), area.x), area.x + area.width - width);
    const y = Math.min(Math.max(Math.round(overlayAnchor?.top ?? area.y + 2), area.y), area.y + area.height - OVERLAY_HEIGHT);
    place(overlay, { x, y, width, height });
  }

  function setOverlayDetail(open: boolean, wide = false): void {
    if (open === overlayDetail && wide === overlayWide) return;
    overlayDetail = open;
    overlayWide = open && wide;
    if (overlay?.isVisible()) setOverlay(true, overlayCount);
  }

  function setOverlayFocus(focus: boolean): void {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.setFocusable(focus);
    if (focus) {
      overlayInteractive = true;
      overlay.setIgnoreMouseEvents(false);
      if (!hidden) overlay.focus();
    } else {
      overlayInteractive = false;
      overlay.setIgnoreMouseEvents(true, { forward: true });
    }
  }

  function dragOverlay(phase: 'start' | 'end' | 'reset'): void {
    if (!overlay || overlay.isDestroyed()) return;
    if (dragTimer) clearInterval(dragTimer);
    dragTimer = null;
    if (phase === 'reset') {
      overlayAnchor = null;
      opts.onOverlayMoved?.(null);
      setOverlay(true, overlayCount);
      return;
    }
    const bounds = overlay.getBounds();
    if (phase === 'end') {
      overlayAnchor = { centerX: bounds.x + bounds.width / 2, top: bounds.y };
      opts.onOverlayMoved?.(hidden ? null : overlayAnchor);
      return;
    }
    // Follows the cursor until released (a safety stop after a minute, in case the release is missed).
    const start = screen.getCursorScreenPoint();
    const from = { x: bounds.x, y: bounds.y };
    const began = Date.now();
    dragTimer = setInterval(() => {
      if (!overlay || overlay.isDestroyed() || Date.now() - began > 60_000) return dragOverlay('end');
      const at = screen.getCursorScreenPoint();
      overlay.setPosition(from.x + at.x - start.x, from.y + at.y - start.y);
    }, 16);
  }

  function setOverlayInteractive(interactive: boolean): void {
    if (!overlay || interactive === overlayInteractive) return;
    overlayInteractive = interactive;
    if (interactive) overlay.setIgnoreMouseEvents(false);
    else overlay.setIgnoreMouseEvents(true, { forward: true });
  }

  function openPopup(view: PopupView): void {
    popupShows = view;
    const area = screen.getPrimaryDisplay().workArea;
    const present = (win: BrowserWindow): void => {
      win.setBounds(at(area));
      win.webContents.send('popup:show', view);
      reveal(win, true);
    };
    if (popup && !popup.isDestroyed()) {
      present(popup);
      return;
    }
    const win = createWindow('popup', {
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      title: 'Claude Manager',
    });
    win.setAlwaysOnTop(true, 'floating');
    win.once('ready-to-show', () => present(win));
    popup = win;
  }

  function closePopup(): void {
    popupShows = null;
    if (popup && !popup.isDestroyed()) popup.hide();
  }

  function snap(mode: SnapMode): void {
    if (hidden) return;
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
    if (hidden || main.isMaximized() || main.getContentSize()[0]! >= width) return false;
    main.maximize();
    return true;
  }

  function showMain(): void {
    if (main.isMinimized()) main.restore();
    reveal(main, true);
  }

  return {
    showMain,
    hideMain: () => main.hide(),
    allowMainClose: () => void (closeAllowed = true),
    setDock,
    setOverlay,
    setOverlayInteractive,
    dragOverlay,
    setOverlayDetail,
    setOverlayFocus,
    setTheme: (theme) => main.setTitleBarOverlay({ ...TITLE_BAR[theme], height: TITLE_BAR_HEIGHT }),
    openPopup,
    closePopup,
    popupView: () => popupShows,
    snap,
    ensureWidth,
    flash: (on) => main.flashFrame(on && !hidden && !main.isFocused()),
    send: (channel, payload) => {
      for (const win of [main, dock, overlay, popup]) {
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
      }
    },
    destroyAll: () => {
      for (const win of [popup, dock, overlay, main]) if (win && !win.isDestroyed()) win.destroy();
    },
  };
}
