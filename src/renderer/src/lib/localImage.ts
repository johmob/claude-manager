const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** A file: URL or a Windows path (drive or network share), possibly percent-encoded by the markdown parser. */
export function isLocalPath(ref: string): boolean {
  return /^(?:file:\/\/|[a-zA-Z]:(?:[\\/]|%5C)|\\\\|%5C%5C)/i.test(ref.trim());
}

/** The Windows path a link target or reference stands for (file: URL, percent-encoded, <…> or quotes removed), or null. */
export function filePathOf(ref: string): string | null {
  let path = ref.trim().replace(/^<|>$/g, '').replace(/^["'`]|["'`]$/g, '');
  if (/^file:\/\//i.test(path)) {
    try {
      path = decodeURIComponent(new URL(path).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
    } catch {
      return null;
    }
  } else if (path.includes('%')) {
    // The markdown parser percent-encodes link targets ("C:%5CMina%20bilder%5Ca.png").
    try {
      path = decodeURIComponent(path);
    } catch {
      return null;
    }
  }
  if (!/^[a-zA-Z]:[\\/]/.test(path) && !path.startsWith('\\\\')) return null;
  return path;
}

/**
 * A local image an agent refers to (a Windows path or a file: URL) as an address the app can show
 * (main serves it on cm-img://), or null when the reference is not a local image.
 */
export function localImageUrl(ref: string): string | null {
  const path = filePathOf(ref);
  if (!path || !IMAGE_FILE.test(path)) return null;
  return `cm-img://local/${encodeURIComponent(path)}`;
}

/**
 * Markdown links and images to local image files, with the target wrapped in <…> so a Windows path with
 * spaces still parses ("![x](C:\Mina bilder\a.png)" is otherwise plain text).
 */
export function wrapLocalImageLinks(text: string): string {
  return text.replace(/\]\(((?:[a-zA-Z]:[\\/]|file:\/\/)[^)\n<>]*?\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi, '](<$1>)');
}

const LOCAL_IMAGE_PREFIX = 'cm-img://local/';

/** The file path behind an app image address (the reverse of localImageUrl), or null. */
export function imagePathOf(src: string): string | null {
  if (!src.startsWith(LOCAL_IMAGE_PREFIX)) return null;
  try {
    return decodeURIComponent(src.slice(LOCAL_IMAGE_PREFIX.length));
  } catch {
    return null;
  }
}

