// tag-memory: remembers the tags a cheap model gave a session's messages, on disk, so the transcript keeps
// them after a restart (the history is rebuilt from Claude Code's saved conversation, without tags). Keyed
// by a hash of the message text, one file per card.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK_TAGS, type BlockTag } from '../../../shared/contracts';

const MAX_MESSAGES = 3000;

type Tags = Array<BlockTag | null>;

export interface TagMemory {
  /** The saved tags of a message, by its text; undefined when it was never tagged. */
  recall(sessionId: string, text: string): Tags | undefined;
  remember(sessionId: string, items: Array<{ text: string; tags: Tags }>): void;
  forget(sessionId: string): void;
}

function keyOf(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function validTags(raw: unknown): Tags | null {
  if (!Array.isArray(raw)) return null;
  return raw.every((t) => t === null || (BLOCK_TAGS as readonly unknown[]).includes(t)) ? (raw as Tags) : null;
}

export function createTagMemory(dir: string): TagMemory {
  const cache = new Map<string, Map<string, Tags>>();
  const fileOf = (id: string): string => join(dir, `${id.replace(/[^\w-]/g, '_')}.json`);

  function load(id: string): Map<string, Tags> {
    const cached = cache.get(id);
    if (cached) return cached;
    const map = new Map<string, Tags>();
    try {
      const raw: unknown = JSON.parse(readFileSync(fileOf(id), 'utf8'));
      if (raw && typeof raw === 'object') {
        for (const [key, value] of Object.entries(raw)) {
          const tags = validTags(value);
          if (tags) map.set(key, tags);
        }
      }
    } catch {
      // Nothing saved yet.
    }
    cache.set(id, map);
    return map;
  }

  return {
    recall: (id, text) => load(id).get(keyOf(text)),
    remember(id, items) {
      const map = load(id);
      for (const { text, tags } of items) {
        const key = keyOf(text);
        map.delete(key); // newest last, so the oldest go first when trimming
        map.set(key, tags);
      }
      while (map.size > MAX_MESSAGES) map.delete(map.keys().next().value!);
      mkdirSync(dir, { recursive: true });
      const file = fileOf(id);
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)), 'utf8');
      renameSync(tmp, file);
    },
    forget(id) {
      cache.delete(id);
      rmSync(fileOf(id), { force: true });
    },
  };
}
