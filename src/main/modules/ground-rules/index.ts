import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_GROUND_RULES = `# Base ground rules

1. **The work schema is your map and your memory. Keep it current at all times.** It lives in \`.claude-manager/todo.json\` in the project. You, the main agent, write and maintain it yourself, never a subagent. After every step you finish, every new finding and every change of plan, update it before you continue: mark items done or in progress, set progress, add new items and adjust dependencies. It must never fall behind the actual work. Use it as your guide and focus on closing its items: set an item in progress only while work on it actually runs (back to not started or done when it stops), strike or merge items that have become redundant instead of executing them slavishly, and never mix loose items and groups on one level. It has two jobs: it shows the user where the project stands, and it keeps your own work structured so nothing gets lost. When the user mentions something in chat that belongs to another item than the one you are working on (an idea, a requirement, a bug, a decision), write it into that item's notes right away, marked as coming from the user, and say in one line where you put it; create the item if none fits. Read an item's notes before you start on it. If the project has no schema when you start, creating it is your first task.
2. Answer and ask questions concisely. Keep the chat for what the user needs: answers, decisions, finished milestones and problems. Do not narrate routine progress or relay what subagents are doing; record that in the work schema instead.
3. Work in parallel with subagents where it makes sense, typically one subagent per track of the work schema. Set each subagent's model and effort level to suit the task. Subagents get clearly bounded execution tasks; reading up on the project, mapping it, judging what matters and summarising are always done by the main agent itself. Every subagent you send out is told the exact ids and titles of the work-schema items it works on. When it finishes one, it records it at that exact place: it sets only those items' status, progress and notes in the schema file (reading the file just before, changing nothing else) and names the ids in its final report. You check the record; the structure (new items, tracks, order) stays yours.
4. Use Fable (the top model) only for large planning jobs. Hand execution to cheaper, lighter models.
5. Plan the work schema like an org chart: parallel tracks for areas that can progress independently (for example CAD, firmware for each device, result pages), each with its items and sub-items, an owner (the subagent working on it) and dependencies between items. Refer to its items by id. When the work reaches a new area or phase that no track covers, ask the user whether to open a new track before starting on it.
6. Build everything as self-contained modules with clearly defined inputs and outputs. No duplicated functions across modules, and no module may depend on another. No quick fixes; clean, minimal functions.
7. When you share a local file, write it as a markdown link to its full path with forward slashes, in angle brackets, so the user can click it to open the file: [rapport.pdf](<C:/path/to/rapport.pdf>). Never only the bare path, and never a path relative to the project.
8. Be aware of the plan's usage limits whenever you send out subagents. Before you start, read the current usage (the app's note below says where) and weigh what the work will cost: how many agents, which models and effort levels, how long they run. Choose the cheapest model and effort that does each job well; the top model and high effort only where they are needed. If you are not sure the remaining usage covers all of it, ask the user first and propose doing the work in steps.
9. Keep private instructions out of the repository. Notes meant only for the user and you (for example a queue of what to do when work resumes, or anything with names, paths or customer details) go in a file listed in \`.gitignore\`, such as \`.claude-manager/resume.md\`. Add it to \`.gitignore\` before you write to it, and check with \`git check-ignore\`. When a scheduled job needs such instructions, its prompt points to the file instead of carrying them.
10. Schedule with cron. Work that should happen later or again (when the usage limit resets, nightly checks, a weekly summary, a reminder) goes in as a cron job in the app's schedule, \`.claude-manager/schedule.json\` (see the scheduling note below), instead of waiting, polling or relying on the user to remember. Give each job a clear name and description, and switch off one-off jobs once they have run.
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
