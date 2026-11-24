import { describe, expect, it } from 'vitest';
import type { TodoNode } from '../../../shared/contracts';
import { orderTracks } from './todoTree';

const node = (id: string, status: TodoNode['status'], focus = false): TodoNode => ({
  id, title: id, status, progress: 0, owner: '', dependsOn: [], blocked: false, notes: '', focus, children: [],
});

describe('orderTracks', () => {
  it('puts focus, then work in progress, then the rest, finished last; stable', () => {
    const t = [node('a', 'done'), node('b', 'not_started'), node('c', 'in_progress'), node('d', 'not_started', true), node('e', 'not_started')];
    expect(orderTracks(t, true).map((x) => x.id)).toEqual(['d', 'c', 'b', 'e', 'a']);
  });
});
