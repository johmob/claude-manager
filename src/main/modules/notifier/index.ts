import { Notification } from 'electron';

export interface AlertRequest {
  sessionId: string;
  title: string;
  body: string;
  urgent: boolean;
}

export interface Notifier {
  alert(req: AlertRequest): void;
  clear(sessionId: string): void;
  setDoNotDisturb(on: boolean): void;
}

export function createNotifier(opts: { onClick: (sessionId: string) => void; flash: (on: boolean) => void }): Notifier {
  const toasts = new Map<string, Notification>();
  const urgent = new Set<string>();
  let doNotDisturb = false;

  const syncFlash = (): void => opts.flash(!doNotDisturb && urgent.size > 0);

  const closeToast = (sessionId: string): void => {
    toasts.get(sessionId)?.close();
    toasts.delete(sessionId);
  };

  const showToast = (req: AlertRequest): void => {
    if (!Notification.isSupported()) return;
    const toast = new Notification({ title: req.title, body: req.body, silent: !req.urgent });
    toast.on('click', () => opts.onClick(req.sessionId));
    closeToast(req.sessionId);
    toasts.set(req.sessionId, toast);
    toast.show();
  };

  return {
    alert(req) {
      if (req.urgent) urgent.add(req.sessionId);
      if (doNotDisturb) return;
      showToast(req);
      syncFlash();
    },
    clear(sessionId) {
      closeToast(sessionId);
      urgent.delete(sessionId);
      syncFlash();
    },
    setDoNotDisturb(on) {
      doNotDisturb = on;
      if (on) [...toasts.keys()].forEach(closeToast);
      syncFlash();
    },
  };
}
