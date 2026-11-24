import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_GROUND_RULES = `# Ground rules: check these off at each point

**When a task starts**
- [ ] Open the work schema \`.claude-manager/todo.json\` (create it if missing). Find the items, read their notes, set them in progress.

**When work is bigger than a small fix**
- [ ] You read up, judge and summarise yourself. One planning agent (by default Opus at medium or high effort; choose what suits the job) writes bounded tasks: files, inputs, outputs, tests.
- [ ] Each coding agent gets the lowest model and effort its task needs: Haiku for mechanical edits, Sonnet for ordinary work, Opus only if the task demands it.
- [ ] Tell each agent its item ids and titles. Run agents in parallel only where files do not overlap. Review their work.

**When a step finishes or the plan changes**
- [ ] Update the schema before going on: status, progress, notes. In progress only while work runs; strike redundant items.
- [ ] Did the user mention something for another item? Put it in that item's notes ("Användaren: …").

**Before you end your turn**
- [ ] The schema matches reality; nothing is in progress that is not running.
- [ ] Reply briefly: answers, decisions, results, problems. Local files as [name](<C:/full/path>).
- [ ] Work for later or again is a cron job in \`.claude-manager/schedule.json\`; one-off jobs are off once run.

**Always**
- Self-contained modules with clear inputs and outputs; no module depends on another, no duplicates, no quick fixes.
- Private notes (names, paths, customers, a resume queue) go in gitignored files such as \`.claude-manager/resume.md\`, never in the repo.
`;

/** Fingerprints of earlier default texts. A file still holding one of them was never edited by the user, so it is upgraded. */
const PREVIOUS_DEFAULTS = new Set([
  'f4809887d5a8310b', '222faea5917d1d55', '06e730423fed7e6d', 'c9c10b010d4cdbdc', '8bed523f8a84f87d', '4f8f743b6acd9f72',
  '1ef6ca3130c06600', '8ce2da83da1f502c', '905d81acb0c04a60', '44aa4c40f344239e', 'b7acfad3b7a4e350', '3c9cae5373902d7c',
]);

export function fingerprint(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16);
}

export interface GroundRules {
  readonly path: string;
  ensure(): void;
  read(): string;
}

export function createGroundRules(filePath: string): GroundRules {
  const ensure = (): void => {
    if (existsSync(filePath) && !PREVIOUS_DEFAULTS.has(fingerprint(readFileSync(filePath, 'utf8')))) return;
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
