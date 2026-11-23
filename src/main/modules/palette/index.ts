export const SESSION_COLORS: readonly string[] = [
  '#5aa9ff', '#ff8a5c', '#58d68d', '#c792ea', '#ffd166', '#4dd0e1',
  '#ff6f91', '#a3e635', '#f59e0b', '#8b9dff', '#2dd4bf', '#f472b6',
];

export function pickColor(used: readonly string[]): string {
  const counts = SESSION_COLORS.map((color) => used.filter((u) => u.toLowerCase() === color).length);
  return SESSION_COLORS[counts.indexOf(Math.min(...counts))];
}
