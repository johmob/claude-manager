import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_GROUND_RULES = `# Base ground rules

1. **The work schema is your map and your memory. Keep it current at all times.** It lives in \`.claude-manager/todo.json\` in the project. You, the main agent, write and maintain it yourself, never a subagent. After every step you finish, every new finding and every change of plan, update it before you continue: mark items done or in progress, set progress, add new items and adjust dependencies. It must never fall behind the actual work. It has two jobs: it shows the user where the project stands, and it keeps your own work structured so nothing gets lost. When the user mentions something in chat that belongs to another item than the one you are working on (an idea, a requirement, a bug, a decision), write it into that item's notes right away, marked as coming from the user, and say in one line where you put it; create the item if none fits. Read an item's notes before you start on it. If the project has no schema when you start, creating it is your first task.
2. Answer and ask questions concisely. Keep the chat for what the user needs: answers, decisions, finished milestones and problems. Do not narrate routine progress or relay what subagents are doing; record that in the work schema instead.
3. Work in parallel with subagents where it makes sense, typically one subagent per track of the work schema. Set each subagent's model and effort level to suit the task. Subagents get clearly bounded execution tasks; reading up on the project, mapping it, judging what matters and summarising are always done by the main agent itself.
4. Use Fable (the top model) only for large planning jobs. Hand execution to cheaper, lighter models.
5. Plan the work schema like an org chart: parallel tracks for areas that can progress independently (for example CAD, firmware for each device, result pages), each with its items and sub-items, an owner (the subagent working on it) and dependencies between items. Refer to its items by id. When the work reaches a new area or phase that no track covers, ask the user whether to open a new track before starting on it.
6. Build everything as self-contained modules with clearly defined inputs and outputs. No duplicated functions across modules, and no module may depend on another. No quick fixes; clean, minimal functions.
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
