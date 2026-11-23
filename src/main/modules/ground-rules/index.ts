import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_GROUND_RULES = `# Base ground rules

1. Answer and ask questions concisely.
2. Work in parallel with subagents where it makes sense, typically one subagent per track of the work schema. Set each subagent's model and effort level to suit the task.
3. Use Fable (the top model) only for large planning jobs. Hand execution to cheaper, lighter models.
4. Before starting, plan the work as a work schema, like an org chart: parallel tracks for areas that can progress independently (for example CAD, firmware for each device, result pages), each with its items and sub-items, an owner (the subagent working on it) and dependencies between items. When the work reaches a new area or phase that no track covers, ask the user whether to open a new track before starting on it. Keep it updated continuously; when the plan changes, update the schema before changing direction. Only the main agent writes it; subagents report to the main agent.
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
