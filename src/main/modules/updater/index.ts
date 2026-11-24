// updater: keeps the installed app current from the project's GitHub releases. It checks now and then. With
// auto-update on it downloads a new version in the background and installs it at the next restart; it never
// restarts the app on its own. "Installera nu" in the top bar installs at once.
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../../../shared/contracts';

export interface UpdaterOptions {
  /** The running version. */
  version: string;
  /** Fetch new versions on their own and install them at the next restart. */
  auto: boolean;
  onStatus: (status: UpdateStatus) => void;
}

export interface Updater {
  setAuto(on: boolean): void;
  /** Installs the new version now, fetching it first if needed. Restarts the app. */
  installNow(): void;
  /** Looks for a new version now instead of waiting for the next regular check. */
  checkNow(): void;
  current(): UpdateStatus;
  stop(): void;
}

// Regular checks are rare; a new release nudges a running app to check at once (see CHECK_UPDATE_ARG).
const FIRST_CHECK_MS = 30 * 1000;
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;

export function createUpdater(opts: UpdaterOptions): Updater {
  let status: UpdateStatus = { state: 'idle', version: opts.version, available: null, progress: 0, auto: opts.auto, message: '' };
  /** The user asked to install: do it as soon as the download is done. */
  let installWhenReady = false;

  const set = (patch: Partial<UpdateStatus>): void => {
    status = { ...status, ...patch };
    opts.onStatus(status);
  };
  const applyAuto = (on: boolean): void => {
    autoUpdater.autoDownload = on;
    autoUpdater.autoInstallOnAppQuit = on;
  };
  applyAuto(opts.auto);
  // Silent, and the app starts again afterwards.
  const install = (): void => autoUpdater.quitAndInstall(true, true);
  const check = (): void => void autoUpdater.checkForUpdates().catch(() => undefined); // errors arrive as 'error' events

  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: '' }));
  autoUpdater.on('update-not-available', () => set({ state: 'idle', available: null }));
  autoUpdater.on('update-available', (info) => {
    set({ state: autoUpdater.autoDownload ? 'downloading' : 'available', available: info.version, progress: 0 });
    if (!autoUpdater.autoDownload && installWhenReady) void autoUpdater.downloadUpdate();
  });
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', available: info.version, progress: 100 });
    if (installWhenReady) install();
  });
  autoUpdater.on('error', (error) => {
    installWhenReady = false;
    set({ state: 'error', message: error.message.split('\n')[0] ?? '' });
  });

  const first = setTimeout(check, FIRST_CHECK_MS);
  const every = setInterval(check, CHECK_EVERY_MS);

  return {
    setAuto(on) {
      applyAuto(on);
      set({ auto: on });
      if (on) check();
    },
    installNow() {
      if (status.state === 'ready') return install();
      installWhenReady = true;
      if (status.state === 'available') void autoUpdater.downloadUpdate();
      else if (status.state !== 'downloading') check();
    },
    checkNow() {
      // Also when a version is ready: a newer release since then replaces it (it used to stick to the first one).
      if (status.state !== 'downloading') check();
    },
    current: () => status,
    stop() {
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
