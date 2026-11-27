// media-permission: which browser permissions the app's own pages get. The microphone is granted only for
// audio, only to the app's own pages; everything else the app does not rely on is refused. Electron grants
// permissions by default when no handler is set, so this is set explicitly on the session.
import type { Session } from 'electron';

/** Permissions the app's pages use besides the microphone. Nothing is used today beyond writing to the clipboard. */
const ALLOWED_OTHER = new Set(['clipboard-sanitized-write']);

export interface MediaRequestDetails {
  mediaTypes?: string[];
  requestingUrl?: string;
}

/** Whether a permission request from a page is granted. */
export function decidePermission(
  permission: string,
  details: MediaRequestDetails,
  isAppUrl: (url: string) => boolean,
): boolean {
  if (permission === 'media') {
    const types = details.mediaTypes ?? [];
    const audioOnly = types.every((t) => t === 'audio');
    return audioOnly && !!details.requestingUrl && isAppUrl(details.requestingUrl);
  }
  return ALLOWED_OTHER.has(permission);
}

/** Sets the request and check handlers on a session, so every permission decision goes through decidePermission. */
export function installPermissionHandlers(ses: Session, isAppUrl: (url: string) => boolean): void {
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const d = details as { mediaTypes?: string[]; requestingUrl?: string };
    callback(decidePermission(permission, { mediaTypes: d.mediaTypes, requestingUrl: d.requestingUrl }, isAppUrl));
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    // A check without a known media type is treated as video (refused here); the request handler decides the grant.
    const mediaType = (details as { mediaType?: string }).mediaType;
    return decidePermission(
      permission,
      { mediaTypes: permission === 'media' ? [mediaType ?? 'unknown'] : undefined, requestingUrl: requestingOrigin },
      isAppUrl,
    );
  });
}

/**
 * Chromium switches that feed a file to the microphone instead of a real device. Only in test instances with a
 * fake-mic file set; otherwise none.
 */
export function fakeMicSwitches(env: NodeJS.ProcessEnv): [string, string?][] {
  const file = env.CLAUDE_MANAGER_FAKE_MIC;
  if (env.CLAUDE_MANAGER_TEST !== '1' || !file) return [];
  return [
    ['use-fake-ui-for-media-stream'],
    ['use-fake-device-for-media-stream'],
    ['use-file-for-fake-audio-capture', `${file}%noloop`],
  ];
}
