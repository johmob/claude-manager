import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_GROUND_RULES = `# Base ground rules

1. Answer and ask questions concisely.
2. Work in parallel with subagents where it makes sense. Set each subagent's model and effort level to suit the task.
3. Use Fable (the top model) only for large planning jobs. Hand execution to cheaper, lighter models.
4. Before starting, write a todo tree: numbered main blocks with sub-steps. Keep it updated continuously. When the plan changes, update the tree before changing direction. Only the main agent writes to it.
5. Build everything as self-contained modules with clearly defined inputs and outputs. No duplicated functions across modules, and no module may depend on another. No quick fixes; clean, minimal functions.
`;

export interface GroundRules {
  readonly path: string;
  ensure(): void;
  read(): string;
}

export function createGroundRules(filePath: string): GroundRules {
  const ensure = (): void => {
    if (existsSync(filePath)) return;
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, DEFAULT_GROUND_RULES, 'utf8');
  };
  return {
    path: filePath,
    ensure,
    read() {
      ensure();
      return readFileSync(filePath, 'utf8');
    },
  };
}

export function groundRulesEditorPrompt(filePath: string, instructions: string): string {
  return `Your only job is to merge the user's instructions into the base CLAUDE.md at:
${filePath}

1. Read that file.
2. Add or adjust rules so it reflects the instructions below. Keep it concise and numbered.
3. Do not touch any other file.
4. Reply with a one-line summary of what changed.

User's instructions (verbatim):
<instructions>
${instructions}
</instructions>`;
}
