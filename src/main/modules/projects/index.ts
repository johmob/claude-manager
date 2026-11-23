import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

export interface Projects {
  list(): string[];
  create(name: string): string;
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const INVALID_NAME = 'Ogiltigt projektnamn';

export function sanitizeFolderName(name: string): string {
  const clean = name.replace(INVALID_CHARS, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (clean === '' || RESERVED_NAMES.test(clean.split('.')[0])) throw new Error(INVALID_NAME);
  return clean;
}

export function createProjects(getRoot: () => string): Projects {
  return {
    list() {
      const root = getRoot();
      try {
        return readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => join(root, entry.name))
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      } catch {
        return [];
      }
    },
    create(name) {
      const path = resolve(getRoot(), sanitizeFolderName(name));
      if (existsSync(path)) throw new Error(`Mappen finns redan: ${path}`);
      mkdirSync(path, { recursive: true });
      return path;
    },
  };
}

export interface LocateOutcome {
  path: string | null;
  reason: string;
}

const LOCATE_SCHEMA = {
  type: 'object',
  properties: { path: { type: ['string', 'null'] }, reason: { type: 'string' } },
  required: ['path', 'reason'],
  additionalProperties: false,
} as const;

function locatePrompt(description: string, candidates: string[]): string {
  return `Pick the project folder that best matches the user's description.

Candidate folders:
${candidates.map((c) => `- ${c}`).join('\n')}

Description (plain language):
${description}

You may peek at README files or file names to decide. Answer with the single best matching absolute folder path from the candidate list, or null if none fits, and a short reason in Swedish.`;
}

function readOutcome(value: unknown): LocateOutcome | null {
  if (typeof value !== 'object' || value === null) return null;
  const { path, reason } = value as { path?: unknown; reason?: unknown };
  return {
    path: typeof path === 'string' ? path : null,
    reason: typeof reason === 'string' ? reason : '',
  };
}

export async function locateProject(root: string, description: string, candidates: string[]): Promise<LocateOutcome> {
  try {
    const run = query({
      prompt: locatePrompt(description, candidates),
      options: {
        cwd: root,
        model: 'haiku',
        tools: ['Read', 'Glob', 'Grep'],
        permissionMode: 'dontAsk',
        settingSources: [],
        maxTurns: 8,
        outputFormat: { type: 'json_schema', schema: LOCATE_SCHEMA as unknown as Record<string, unknown> },
      },
    });
    for await (const message of run) {
      if (message.type !== 'result') continue;
      const outcome = message.subtype === 'success' ? readOutcome(message.structured_output) : null;
      if (!outcome) return { path: null, reason: 'Kunde inte avgöra vilket projekt som avses' };
      const match = candidates.find((c) => c.toLowerCase() === outcome.path?.toLowerCase());
      return { path: match ?? null, reason: outcome.reason };
    }
    return { path: null, reason: 'Inget svar från sökningen' };
  } catch {
    return { path: null, reason: 'Sökningen misslyckades' };
  }
}
