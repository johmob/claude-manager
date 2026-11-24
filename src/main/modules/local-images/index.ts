// local-images: lets the app's windows show image files from disk that agents refer to, through an
// app-only scheme (cm-img://local/<encoded path>). Only image files are served; anything else is refused.
import { net, protocol } from 'electron';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LOCAL_IMAGE_SCHEME = 'cm-img';
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};
const IMAGE_EXTENSIONS = new Set(Object.keys(IMAGE_TYPES));
/** Must run before the app is ready. */
export function registerLocalImageScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: LOCAL_IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

/** Once the app is ready: serves image files from disk on the scheme. */
export function serveLocalImages(): void {
  protocol.handle(LOCAL_IMAGE_SCHEME, async (request) => {
    const path = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) return new Response('Bara bildfiler visas.', { status: 403 });
    try {
      return await net.fetch(pathToFileURL(path).toString());
    } catch {
      return new Response('Bilden finns inte.', { status: 404 });
    }
  });
}
