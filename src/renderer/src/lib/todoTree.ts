// Helpers for reading a work schema (TodoTree), shared by the desktop org chart and the phone's list.
import type { TodoNode } from '../../../shared/contracts';

export const OTHER_TITLE = 'Övrigt';

/** Finished items, and the agent-written "Klart (…)" summary items, are shown as one folded row instead of as items. */
export const isDoneRow = (node: TodoNode): boolean => node.status === 'done' || node.title.startsWith('Klart (');

/** The lowest-level items under a node (the node itself when it has no children). */
export function leavesOf(node: TodoNode): TodoNode[] {
  return node.children.length ? node.children.flatMap(leavesOf) : [node];
}

/**
 * The items of one level in reading order. A level is either all groups or all leaves: loose items
 * beside groups are gathered under one group "Övrigt", last. Finished items are set aside for the folded row.
 */
export function arrangeLevel(parent: TodoNode): { open: TodoNode[]; done: TodoNode[] } {
  const done = parent.children.filter(isDoneRow);
  const rest = parent.children.filter((c) => !isDoneRow(c));
  const groups = rest.filter((c) => c.children.length);
  const loose = rest.filter((c) => !c.children.length);
  if (!groups.length || !loose.length) return { open: rest, done };
  const other: TodoNode = {
    id: `${parent.id}.other`,
    title: OTHER_TITLE,
    status: loose.some((l) => l.status === 'in_progress') ? 'in_progress' : 'not_started',
    progress: Math.round(loose.reduce((sum, l) => sum + l.progress, 0) / loose.length),
    owner: '',
    dependsOn: [],
    blocked: false,
    notes: '',
    focus: false,
    children: loose,
  };
  return { open: [...groups, other], done };
}

/** In progress somewhere in the item, and whether an agent is working now ("live") or not ("rest"). */
export function workStateOf(node: TodoNode, active: boolean): 'live' | 'rest' | undefined {
  if (!leavesOf(node).some((l) => l.status === 'in_progress')) return undefined;
  return active ? 'live' : 'rest';
}

/** The node without its finished parts; null when it is finished itself. */
export function withoutDone(node: TodoNode): TodoNode | null {
  if (node.status === 'done') return null;
  return { ...node, children: node.children.flatMap((c) => withoutDone(c) ?? []) };
}

/** Tracks in display order (stable): focus first, then work in progress, then the rest, finished last. */
export function orderTracks(tracks: TodoNode[], active: boolean): TodoNode[] {
  const rank = (t: TodoNode): number => (t.focus ? 0 : workStateOf(t, active) ? 1 : t.status === 'done' ? 3 : 2);
  return tracks.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
}
