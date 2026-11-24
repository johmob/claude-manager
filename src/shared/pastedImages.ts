// Pasted images reach the agent as files: the app saves each one and the message carries a line with
// its path, which the agent opens with its Read tool. The chat shows those lines as thumbnails.

export const PASTE_MAX_BYTES = 5 * 1024 * 1024;
export const PASTE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

const IMAGE_LINE = /^\[Bild: (.+)\]$/;

/** The line that tells the agent where a pasted image is. */
export function imageLine(path: string): string {
  return `[Bild: ${path}]`;
}

/** A message from the typed text and the saved image paths; images alone make a valid message. */
export function withImages(text: string, paths: string[]): string {
  const lines = paths.map(imageLine).join('\n');
  const body = text.trim();
  return body && lines ? `${body}\n\n${lines}` : body || lines;
}

/** Splits a message into its text and the pasted image paths in it. */
export function splitImageRefs(text: string): { text: string; images: string[] } {
  const images: string[] = [];
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const path = IMAGE_LINE.exec(line.trim())?.[1];
    if (path) images.push(path);
    else kept.push(line);
  }
  return { text: images.length ? kept.join('\n').trim() : text, images };
}
