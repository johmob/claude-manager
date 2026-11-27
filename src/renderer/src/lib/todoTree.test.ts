import { describe, expect, it } from 'vitest';
import type { TodoNode } from '../../../shared/contracts';
import { arrangeLevel, orderTracks } from './todoTree';

const node = (id: string, status: TodoNode['status'], focus = false, weight = 1): TodoNode => ({
  id, title: id, status, progress: status === 'done' ? 100 : 0, weight, owner: '', dependsOn: [], blocked: false, notes: '', focus, children: [],
});

describe('orderTracks', () => {
  it('puts focus, then work in progress, then the rest, finished last; stable', () => {
    const t = [node('a', 'done'), node('b', 'not_started'), node('c', 'in_progress'), node('d', 'not_started', true), node('e', 'not_started')];
    expect(orderTracks(t, true).map((x) => x.id)).toEqual(['d', 'c', 'b', 'e', 'a']);
  });
});

describe('arrangeLevel', () => {
  it('weights the synthetic "Övrigt" group by item size', () => {
    const group: TodoNode = { ...node('g', 'in_progress'), children: [node('g1', 'not_started')] };
    const parent: TodoNode = { ...node('p', 'in_progress'), children: [group, { ...node('x', 'in_progress', false, 3), progress: 100 }, node('y', 'not_started', false, 1)] };
    const other = arrangeLevel(parent).open.find((n) => n.title === 'Övrigt')!;
    expect(other.weight).toBe(4);
    expect(other.progress).toBe(75);
  });
});
