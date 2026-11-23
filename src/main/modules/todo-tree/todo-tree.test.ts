import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TodoTree } from '../../../shared/contracts';
import { createTodoWatcher, parseTodoTree, TODO_RELATIVE_PATH } from './index';

describe('parseTodoTree', () => {
  it('parses a valid tree', () => {
    const tree = parseTodoTree(
      JSON.stringify({ title: 'T', updated: 'u', blocks: [{ id: 1, title: 'B', status: 'done', steps: [{ id: '1.1', title: 'S', status: 'in_progress' }] }] }),
    );
    expect(tree?.blocks[0]).toEqual({ id: '1', title: 'B', status: 'done', steps: [{ id: '1.1', title: 'S', status: 'in_progress' }] });
  });

  it('is tolerant of odd input', () => {
    const tree = parseTodoTree(JSON.stringify({ blocks: [{ title: 'B', status: 'weird' }, { id: 2 }] }));
    expect(tree?.blocks).toEqual([{ id: '1', title: 'B', status: 'not_started', steps: [] }]);
  });

  it('rejects invalid JSON and wrong shapes', () => {
    expect(parseTodoTree('{nope')).toBeNull();
    expect(parseTodoTree('[]')).toBeNull();
    expect(parseTodoTree('{"title":"x"}')).toBeNull();
  });
});

describe('createTodoWatcher', () => {
  it('emits null first, then the tree once written', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'todo-'));
    const calls: Array<TodoTree | null> = [];
    const watcher = createTodoWatcher((_id, tree) => calls.push(tree));
    watcher.watch('s1', cwd);
    expect(calls).toEqual([null]);
    mkdirSync(join(cwd, '.claude-manager'));
    writeFileSync(join(cwd, TODO_RELATIVE_PATH), JSON.stringify({ title: 'T', updated: '', blocks: [] }));
    const deadline = Date.now() + 5000;
    while (calls.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    watcher.close();
    expect(calls.length).toBe(2);
    expect(calls[1]?.title).toBe('T');
  });
});
