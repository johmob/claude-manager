/** Session colours: muted mid-tones that tell sessions apart without glaring on a dark screen. */
export const SESSION_COLORS: readonly string[] = [
  '#4a78b0', '#b8704f', '#4f9a6e', '#8a6fb0', '#b39a4e', '#3f8f9a',
  '#b05a72', '#7c9a3f', '#b07a2e', '#6a76b8', '#3a9486', '#a85a8c',
];

/** The bright colours sessions used to get, in the same order as their muted replacements. */
const EARLIER_COLORS: readonly string[] = [
  '#5aa9ff', '#ff8a5c', '#58d68d', '#c792ea', '#ffd166', '#4dd0e1',
  '#ff6f91', '#a3e635', '#f59e0b', '#8b9dff', '#2dd4bf', '#f472b6',
];

export function pickColor(used: readonly string[]): string {
  const counts = SESSION_COLORS.map((color) => used.filter((u) => u.toLowerCase() === color).length);
  return SESSION_COLORS[counts.indexOf(Math.min(...counts))];
}

/** A saved session's colour, with an earlier bright one replaced by its muted counterpart. */
export function currentColor(color: string): string {
  const i = EARLIER_COLORS.indexOf(color.toLowerCase());
  return i === -1 ? color : SESSION_COLORS[i]!;
}
