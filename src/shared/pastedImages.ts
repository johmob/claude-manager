// Pasted images and files reach the agent as files: the app saves each one and the message carries a line
// with its path, which the agent opens with its Read tool. The chat shows those lines as thumbnails and chips.

export const PASTE_MAX_BYTES = 5 * 1024 * 1024;
export const PASTE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const PASTE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

const IMAGE_LINE = /^\[Bild: (.+)\]$/;
const FILE_LINE = /^\[Fil: (.+)\]$/;

/** The line that tells the agent where a pasted image is. */
export function imageLine(path: string): string {
  return `[Bild: ${path}]`;
}

/** The line that tells the agent where an attached file is. */
export function fileLine(path: string): string {
  return `[Fil: ${path}]`;
}

/** A message from the typed text and the attached image and file paths; attachments alone make a valid message. */
export function withAttachments(text: string, images: string[], files: string[]): string {
  const lines = [...images.map(imageLine), ...files.map(fileLine)].join('\n');
  const body = text.trim();
  return body && lines ? `${body}\n\n${lines}` : body || lines;
}

export function withImages(text: string, paths: string[]): string {
  return withAttachments(text, paths, []);
}

/** Splits a message into its text and the attached image and file paths in it. */
export function splitAttachments(text: string): { text: string; images: string[]; files: string[] } {
  const images: string[] = [];
  const files: string[] = [];
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    const image = IMAGE_LINE.exec(t)?.[1];
    const file = image ? undefined : FILE_LINE.exec(t)?.[1];
    if (image) images.push(image);
    else if (file) files.push(file);
    else kept.push(line);
  }
  return { text: images.length || files.length ? kept.join('\n').trim() : text, images, files };
}

export function splitImageRefs(text: string): { text: string; images: string[] } {
  const { text: words, images } = splitAttachments(text);
  return { text: words, images };
}
