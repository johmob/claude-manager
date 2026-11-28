import type { TodoNode, TodoTree } from '../../../shared/contracts';

const MAX_FINDINGS = 8;
const MAX_WORDS = 5;
const MAX_TITLE_CHARS = 40;
/** A note on a finished item that still says something is untested or left. */
const STALE_NOTE = /(?<![\p{L}\d])(?:(?:ej|inte) (?:provat|provad|testat|prövat|committat)|kvar att|kvar:|återstår|not tested)(?![\p{L}\d])/iu;
const ARCHIVE_TITLE = /^klart\s*\(/i;

/** Concrete problems in the work schema, each naming the item, so the agent can correct them. */
export function checkSchema(tree: TodoTree, opts: { agentsWorking: boolean }): string[] {
  const found: string[] = [];
  const visit = (node: TodoNode): void => {
    if (ARCHIVE_TITLE.test(node.title)) return;
    const leaf = !node.children.length;
    const name = `${node.id} "${node.title}"`;
    if (leaf && node.status === 'done' && STALE_NOTE.test(node.notes)) found.push(`${node.id} är klar men anteckningen säger något annat ("${node.notes.match(STALE_NOTE)![0]}"). Skriv om den till det som gäller nu`);
    if (leaf && node.status === 'in_progress' && !opts.agentsWorking) found.push(`${node.id} står som pågår men ingen agent arbetar. Sätt rätt status`);
    if (!node.notes) found.push(`${name} saknar anteckning`);
    if (node.title.split(/\s+/).length > MAX_WORDS || node.title.length > MAX_TITLE_CHARS) found.push(`${node.id} har för lång titel (max ${MAX_WORDS} ord). Korta ner den och flytta detaljerna till anteckningen`);
    const groups = node.children.filter((c) => c.children.length).length;
    if (groups && groups < node.children.length) found.push(`${name} blandar punkter och grupper på samma nivå. Gruppera punkterna`);
    node.children.forEach(visit);
  };
  tree.tracks.forEach(visit);
  return found.length > MAX_FINDINGS ? [...found.slice(0, MAX_FINDINGS), `… och ${found.length - MAX_FINDINGS} till`] : found;
}

/** The note sent to the agent with the user's next message; null when there is nothing to say. */
export function schemaReminder(findings: string[], untouched: boolean): string | null {
  if (!untouched && !findings.length) return null;
  const parts: string[] = [];
  if (untouched) {
    parts.push('Under förra turen arbetade du utan att röra arbetsschemat (.claude-manager/todo.json). Uppdatera det först: markera det som blev klart, sätt pågår bara på det som faktiskt pågår just nu och återställ resten, lägg till det som tillkommit och stryk det som blivit överflödigt.');
  }
  if (findings.length) parts.push(`Rätta i arbetsschemat:\n${findings.map((f) => `- ${f}`).join('\n')}`);
  return `${parts.join('\n\n')}\nNämn det inte i chatten.`;
}
