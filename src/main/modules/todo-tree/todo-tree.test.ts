import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TodoTree } from '../../../shared/contracts';
import { createTodoWatcher, mappingRequest, parseTodoTree, TODO_RELATIVE_PATH } from './index';

describe('parseTodoTree', () => {
  const schema = {
    title: 'Demo',
    updated: 'u',
    tracks: [
      {
        id: 'fw-a',
        title: 'Firmware – styrenhet',
        owner: 'firmware-a',
        items: [
          { id: 'fw-a.1', title: 'SPI', status: 'done' },
          { id: 'fw-a.2', title: 'Protokoll', status: 'in_progress', progress: 40 },
        ],
      },
      { id: 'web', title: 'Webb', owner: 'main', items: [{ id: 'web.1', title: 'Graf', status: 'not_started', dependsOn: ['fw-a.2', 'okänd'] }] },
    ],
  };

  it('computes tracks from their items and the overall progress', () => {
    const tree = parseTodoTree(JSON.stringify(schema))!;
    const [fw, web] = tree.tracks;
    expect(fw).toMatchObject({ id: 'fw-a', owner: 'firmware-a', status: 'in_progress', progress: 70 });
    expect(web).toMatchObject({ status: 'not_started', progress: 0 });
    expect(tree).toMatchObject({ progress: 35, doneItems: 1, inProgressItems: 1, totalItems: 3 });
  });

  it('marks items blocked by unfinished dependencies, also across tracks', () => {
    const tree = parseTodoTree(JSON.stringify(schema))!;
    expect(tree.tracks[1]!.children[0]).toMatchObject({ id: 'web.1', blocked: true, dependsOn: ['fw-a.2', 'okänd'] });
    expect(tree.tracks[0]!.children[1]!.blocked).toBe(false);
  });

  it('nests sub-items and rolls them up', () => {
    const tree = parseTodoTree(
      JSON.stringify({ tracks: [{ title: 'CAD', items: [{ title: 'Hölje', items: [{ title: 'Skiss', status: 'done' }, { title: 'Fästen', status: 'done' }] }] }] }),
    )!;
    expect(tree.tracks[0]).toMatchObject({ id: '1', status: 'done', progress: 100 });
    expect(tree.tracks[0]!.children[0]!.children.map((c) => c.id)).toEqual(['1.1.1', '1.1.2']);
  });

  it('still reads the earlier blocks/steps format', () => {
    const tree = parseTodoTree(
      JSON.stringify({ title: 'T', updated: 'u', blocks: [{ id: 1, title: 'B', status: 'done', steps: [{ id: '1.1', title: 'S', status: 'in_progress' }] }] }),
    )!;
    expect(tree.tracks[0]).toMatchObject({ id: '1', title: 'B', status: 'in_progress', progress: 50 });
    expect(tree.tracks[0]!.children[0]).toMatchObject({ id: '1.1', title: 'S', status: 'in_progress' });
  });

  it('is tolerant of odd input', () => {
    const tree = parseTodoTree(JSON.stringify({ tracks: [{ title: 'B', status: 'weird', progress: 400 }, { id: 2 }] }))!;
    expect(tree.tracks).toEqual([{ id: '1', title: 'B', status: 'not_started', progress: 0, owner: '', dependsOn: [], blocked: false, notes: '', focus: false, children: [] }]);
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
    writeFileSync(join(cwd, TODO_RELATIVE_PATH), JSON.stringify({ title: 'T', updated: '', tracks: [] }));
    // fs.watchFile polls once a second; a busy machine can take several rounds to notice the write.
    const deadline = Date.now() + 12000;
    while (calls.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    watcher.close();
    expect(calls.length).toBe(2);
    expect(calls[1]?.title).toBe('T');
  }, 15000);
});

describe('mappingRequest', () => {
  it('asks the main agent to map the project itself into the schema file', () => {
    const text = mappingRequest('');
    expect(text).toContain(TODO_RELATIVE_PATH);
    expect(text).toContain('subagent');
    expect(text).toContain('"notes"');
    expect(text).not.toContain('Struktur att utgå från');
  });

  it("adds the user's description of the structure", () => {
    expect(mappingRequest('  CAD med 30 delar  ')).toMatch(/Struktur att utgå från.*\nCAD med 30 delar$/s);
  });
});

describe('notes', () => {
  it('reads the agent description of an item, trimmed', () => {
    const tree = parseTodoTree(JSON.stringify({ tracks: [{ id: 't', title: 'T', notes: '  Kvar: CRC.  ', items: [{ id: 't.1', title: 'A', status: 'in_progress' }] }] }));
    expect(tree?.tracks[0]?.notes).toBe('Kvar: CRC.');
    expect(tree?.tracks[0]?.children[0]?.notes).toBe('');
    expect(tree?.inProgressItems).toBe(1);
    expect(tree?.tracks[0]?.focus).toBe(false);
    expect(parseTodoTree(JSON.stringify({ tracks: [{ id: 't', title: 'T', focus: true }] }))?.tracks[0]?.focus).toBe(true);
  });
});
