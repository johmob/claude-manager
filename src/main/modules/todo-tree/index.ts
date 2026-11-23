import { readFileSync, unwatchFile, watchFile } from 'node:fs';
import { join } from 'node:path';
import type { TodoBlock, TodoStatus, TodoStep, TodoTree } from '../../../shared/contracts';
import { isRecord } from '../../../shared/guards';

export const TODO_RELATIVE_PATH = '.claude-manager/todo.json';
const POLL_MS = 1000;

export const TODO_PROTOCOL = `# Todo tree
Before starting real work, write a todo tree to \`${TODO_RELATIVE_PATH}\` in the project root (create the folder if needed), as JSON in exactly this format:
{
  "title": "What this session is building",
  "updated": "2026-11-23T09:00:00Z",
  "blocks": [
    { "id": "1", "title": "Main block", "status": "in_progress",
      "steps": [ { "id": "1.1", "title": "Sub-step", "status": "done" } ] }
  ]
}
- Numbered main blocks, each with sub-steps. status is "not_started", "in_progress" or "done".
- Keep it updated continuously: mark steps in_progress/done as you go and update "updated".
- When the plan changes, update the tree before changing direction.
- Only the main agent writes the file; subagents report to the main agent.
- For a plain question that needs no work, skip the file.`;

const STATUSES: readonly TodoStatus[] = ['not_started', 'in_progress', 'done'];


function toStatus(value: unknown): TodoStatus {
  return STATUSES.find((s) => s === value) ?? 'not_started';
}

function toId(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function toTitle(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function parseStep(raw: unknown, index: number): TodoStep | null {
  if (!isRecord(raw)) return null;
  const title = toTitle(raw.title);
  return title === null ? null : { id: toId(raw.id, String(index + 1)), title, status: toStatus(raw.status) };
}

function parseBlock(raw: unknown, index: number): TodoBlock | null {
  if (!isRecord(raw)) return null;
  const title = toTitle(raw.title);
  if (title === null) return null;
  const steps = Array.isArray(raw.steps) ? raw.steps.map(parseStep).filter((s): s is TodoStep => s !== null) : [];
  return { id: toId(raw.id, String(index + 1)), title, status: toStatus(raw.status), steps };
}

export function parseTodoTree(raw: string): TodoTree | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || !Array.isArray(data.blocks)) return null;
  return {
    title: typeof data.title === 'string' ? data.title : '',
    updated: typeof data.updated === 'string' ? data.updated : '',
    blocks: data.blocks.map(parseBlock).filter((b): b is TodoBlock => b !== null),
  };
}

export interface TodoWatcher {
  watch(sessionId: string, cwd: string): void;
  unwatch(sessionId: string): void;
  close(): void;
}

interface Watched {
  file: string;
  listener: () => void;
}

function readTree(file: string): TodoTree | null {
  try {
    return parseTodoTree(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function createTodoWatcher(onTree: (sessionId: string, tree: TodoTree | null) => void): TodoWatcher {
  const watched = new Map<string, Watched>();

  function stop(sessionId: string): void {
    const entry = watched.get(sessionId);
    if (!entry) return;
    unwatchFile(entry.file, entry.listener);
    watched.delete(sessionId);
  }

  return {
    watch(sessionId, cwd) {
      stop(sessionId);
      const file = join(cwd, TODO_RELATIVE_PATH);
      let last: string | undefined;
      const check = (): void => {
        const tree = readTree(file);
        const serialized = JSON.stringify(tree);
        if (serialized === last) return;
        last = serialized;
        onTree(sessionId, tree);
      };
      watched.set(sessionId, { file, listener: check });
      watchFile(file, { interval: POLL_MS }, check);
      check();
    },
    unwatch: stop,
    close() {
      [...watched.keys()].forEach(stop);
    },
  };
}
