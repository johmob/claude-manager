// local-images: lets the app's windows show image files from disk that agents refer to, through an
// app-only scheme (cm-img://local/<encoded path>). Only image files are served; anything else is refused.
import { net, protocol } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
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
const MAX_REMOTE_IMAGE = 25 * 1024 * 1024;

/** The same rule for the phone: only image files, read from an absolute path; 'forbidden' for anything else. */
export async function readLocalImage(path: string): Promise<{ data: Buffer; type: string } | 'forbidden' | null> {
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!type || !isAbsolute(path)) return 'forbidden';
  try {
    if ((await stat(path)).size > MAX_REMOTE_IMAGE) return null;
    return { data: await readFile(path), type };
  } catch {
    return null;
  }
}

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
