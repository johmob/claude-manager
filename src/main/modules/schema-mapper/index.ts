// schema-mapper: a one-off planning agent (Fable when the account has it) that reads the whole project
// and writes its work schema, then exits. It may read anything in the project and run read-only git
// commands, but it can write nothing except the schema file.
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ModelChoice } from '../../../shared/contracts';

export interface MapOptions {
  cwd: string;
  /** The user's own description of the project's structure; may be empty. */
  guidance: string;
  model: ModelChoice;
  /** The work schema format (TODO_PROTOCOL), so the planner writes exactly what the app reads. */
  protocol: string;
  pathToClaudeCodeExecutable?: string;
}

export interface MapOutcome {
  ok: boolean;
  /** The planner's one-sentence summary, or why it failed. */
  message: string;
}

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const GIT_READ = /^git\s+(log|status|ls-files|show|diff|branch|tag|shortlog|rev-parse|describe)\b/;
const SCHEMA_DIR = '.claude-manager';

export async function mapProject(options: MapOptions): Promise<MapOutcome> {
  const run = query({
    prompt: plannerPrompt(options.guidance, options.protocol),
    options: {
      cwd: options.cwd,
      model: options.model === 'default' ? undefined : options.model,
      effort: 'high',
      permissionMode: 'default',
      persistSession: false,
      maxTurns: 120,
      pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
      canUseTool: async (toolName, input) => decide(toolName, input, options.cwd),
    },
  });
  for await (const message of run) {
    if (message.type !== 'result') continue;
    if (message.subtype === 'success' && !message.is_error) return { ok: true, message: message.result.trim() };
    return { ok: false, message: `Kartläggningen avbröts (${message.subtype}).` };
  }
  return { ok: false, message: 'Kartläggningen gav inget svar.' };
}

/** Allows reading, read-only git and writing inside the schema folder; denies everything else. */
export function decide(toolName: string, input: Record<string, unknown>, cwd: string): PermissionResult {
  if (READ_ONLY_TOOLS.has(toolName)) return { behavior: 'allow', updatedInput: input };
  if ((toolName === 'Bash' || toolName === 'PowerShell') && typeof input['command'] === 'string' && GIT_READ.test(input['command'].trim())) {
    return { behavior: 'allow', updatedInput: input };
  }
  if ((toolName === 'Write' || toolName === 'Edit') && typeof input['file_path'] === 'string' && isInsideSchemaDir(input['file_path'], cwd)) {
    return { behavior: 'allow', updatedInput: input };
  }
  return { behavior: 'deny', message: `Planeraren får bara läsa projektet, köra läsande git-kommandon och skriva ${SCHEMA_DIR}/todo.json.` };
}

/** True when the path (absolute or relative to the project) points inside the project's schema folder. */
export function isInsideSchemaDir(filePath: string, cwd: string): boolean {
  const rel = relative(resolve(cwd, SCHEMA_DIR), resolve(cwd, filePath));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function plannerPrompt(guidance: string, protocol: string): string {
  return `You are the planner for this project. Map it thoroughly and write its work schema to ${SCHEMA_DIR}/todo.json in the format below; then you are done.

Read the project yourself: the folder structure, README and docs, CAD and PCB files (names and structure are enough), every firmware, the web code, build files, TODO/FIXME notes and the git history (read-only git commands are allowed). The project may be large: give every area its own track (for example the CAD assembly and its parts, the PCB, each firmware, the web version, tests, documentation, production). Organise by area, never by phase or chronology, and give the tree depth: items with sub-items for their parts (usually 2-3 levels), covering what exists and what remains. Mark an item done only when the files show it is done. Write nothing except the schema file.

When the schema is written, reply with one sentence naming the tracks, in Swedish.

The user's own description of the structure (may be empty; follow it where given):
<guidance>
${guidance.trim()}
</guidance>

<format>
${protocol}
</format>`;
}

