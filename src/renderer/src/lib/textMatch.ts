function normalize(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>~|-]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether two texts are in effect the same message: equal, one inside the other (similar length), or nearly the same words. */
export function nearlySame(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (long.includes(short) && short.length / long.length >= 0.8) return true;
  const wx = new Set(x.split(' '));
  const wy = new Set(y.split(' '));
  let common = 0;
  for (const w of wx) if (wy.has(w)) common++;
  return common / (wx.size + wy.size - common) >= 0.8;
}
