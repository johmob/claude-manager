import { readFileSync, unwatchFile, watchFile } from 'node:fs';
import { join } from 'node:path';
import type { TodoNode, TodoStatus, TodoTree } from '../../../shared/contracts';
import { isRecord } from '../../../shared/guards';

export const TODO_RELATIVE_PATH = '.claude-manager/todo.json';
const POLL_MS = 1000;

export const TODO_PROTOCOL = `# Work schema
Keep the project's work schema in \`${TODO_RELATIVE_PATH}\` (create the folder if needed). The user sees it as an org chart: the project on top, parallel tracks below, each track's items under it.
- Write it as soon as you know the project, before real work. Mark what is done (judge from code, git history and docs), in progress and left. If the file exists, update it.
- Tracks are areas that can progress independently ("CAD – housing", "Firmware – controller", "Web – result pages"), never phases. Each has an owner: the subagent working on it, or "main". A small job is one track.
- Give it depth: split items into sub-items for their parts (usually 2–3 levels), ids like "fw-a.2.1". At most about seven items per level; group more into packages. Never mix leaves and groups on one level: gather loose items under their own group (e.g. "Övrigt").
- Titles name the thing in at most five words (project title at most four), a noun phrase such as "SPI driver", never a sentence.
- Every track and item has "notes": one to three sentences on what it covers, where it stands, what is left, open questions or risks. Keep them current.
- Leaves may carry "size": relative effort from 1 (under an hour) to 8 (a week or more), default 1. Set it on every new item, always on large ones; the app weights progress by it.
- Leaves carry "status" ("not_started", "in_progress", "done") and, while in progress, "progress" (0–100); the app computes the parents. List prerequisite ids in "dependsOn", also across tracks.
- "in_progress" only while work on the item actually runs; set it back or to "done" the moment it stops. Strike or merge items that turn out redundant instead of carrying them out because they are listed.
- When the user mentions something that belongs to another item (idea, requirement, bug, decision), add it to that item's notes at once, marked "Användaren: …", and say in one line where. Create the item if none fits. Read an item's notes before you start on it.
- The structure (tracks, items, order, dependencies) is yours alone. A subagent sets only its own items' status, progress and notes; check what it recorded. Refer to items by id when you report.
- When the user focuses on a track ("we focus on this today"), set "focus": true on it and work on it first; remove it when the focus ends.
- Before work moves into an area no track covers, ask the user with AskUserQuestion whether to open a new track (propose title and owner, offer an existing track as the alternative). Small sub-items need no question.
- Skip the schema only for a plain question unrelated to the project's work.
- Exact format:
{
  "title": "What this session is building",
  "updated": "2026-11-23T09:00:00Z",
  "tracks": [
    { "id": "fw-a", "title": "Firmware – controller", "owner": "firmware-a", "notes": "STM32 firmware for the controller board: drivers, protocol to the display, control loop.", "items": [
      { "id": "fw-a.1", "title": "SPI driver", "status": "done", "size": 2, "notes": "DMA-based, tested against the pressure sensor at 8 MHz." },
      { "id": "fw-a.2", "title": "Data protocol", "status": "in_progress", "progress": 40, "size": 5, "notes": "Framing and CRC work on the bench. Retries and versioning are left." } ] },
    { "id": "web", "title": "Web – result pages", "owner": "main", "notes": "Pages that show the measurements live and as history.", "items": [
      { "id": "web.1", "title": "Live chart", "status": "not_started", "dependsOn": ["fw-a.2"], "notes": "Needs the data protocol; open question: how many samples per second to show." } ] }
  ]
}`;

/**
 * Sent to a session's main agent to map its project into the work schema. It is shown as the user's
 * message in the transcript, so it is in Swedish. `guidance` is the user's optional description of the structure.
 */
export function mappingRequest(guidance: string): string {
  const lines = [
    'Kartlägg projektet till arbetsschemat nu, före allt annat arbete. Schemat blir din karta resten av samtalet.',
    '- Läs in dig själv och grundligt: mappstrukturen, README och övrig dokumentation, byggfiler, källkod, CAD- och hårdvarufiler och git-historiken. Lämna inte kartläggningen, bedömningen av vad som är viktigt eller sammanfattningen till en subagent.',
    '- Underskatta inte projektet. Se efter hur stort det faktiskt är (antal delar, enheter, firmware, webbdelar, dokumentation) innan du beskriver det.',
    `- Skriv ${TODO_RELATIVE_PATH} i formatet i dina instruktioner: spår per område med djup (oftast 2–3 nivåer), vad som är klart, vad som pågår, vad som återstår och beroenden mellan punkter.`,
    '- Ge varje spår och varje punkt en kort beskrivning i "notes" (1–3 meningar): vad den omfattar, var den står, vad som återstår och eventuella frågor eller risker. Den visas när användaren klickar på punkten, så ingen punkt får sakna beskrivning.',
    '- Finns schemat redan: gå igenom det mot projektet som det ser ut nu och gör om det där det inte stämmer.',
    '- Svara sedan kort: de viktigaste spåren och vad som återstår.',
  ];
  const structure = guidance.trim();
  if (structure) lines.push('', 'Struktur att utgå från, enligt användaren:', structure);
  return lines.join('\n');
}

const STATUSES: readonly TodoStatus[] = ['not_started', 'in_progress', 'done'];


/** Progress of an item in progress that gives none. Done is always 100 and not started always 0. */
const IN_PROGRESS_DEFAULT = 50;

/** A leaf's size (1 small … 8 very large); 1 when missing or not a number. */
function sizeOf(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.round(Math.min(8, Math.max(1, raw))) : 1;
}

/** Child lists under the names the current ("items") and earlier ("steps", "children") formats use. */
function childList(raw: Record<string, unknown>): unknown[] {
  for (const key of ['items', 'steps', 'children']) if (Array.isArray(raw[key])) return raw[key] as unknown[];
  return [];
}

/** Reads one item as written, before parents are computed. */
function parseNode(raw: unknown, fallbackId: string): TodoNode | null {
  if (!isRecord(raw) || typeof raw['title'] !== 'string' || !raw['title'].trim()) return null;
  const id = typeof raw['id'] === 'string' || typeof raw['id'] === 'number' ? String(raw['id']) : fallbackId;
  const status = STATUSES.find((s) => s === raw['status']) ?? 'not_started';
  const written = typeof raw['progress'] === 'number' && Number.isFinite(raw['progress']) ? raw['progress'] : null;
  const children = childList(raw).flatMap((c, i) => parseNode(c, `${id}.${i + 1}`) ?? []);
  return {
    id,
    title: raw['title'].trim(),
    status,
    weight: sizeOf(raw['size']),
    progress: status === 'done' ? 100 : status === 'not_started' ? 0 : Math.round(Math.min(100, Math.max(0, written ?? IN_PROGRESS_DEFAULT))),
    owner: typeof raw['owner'] === 'string' ? raw['owner'].trim() : '',
    dependsOn: Array.isArray(raw['dependsOn']) ? raw['dependsOn'].map(String) : [],
    blocked: false,
    notes: typeof raw['notes'] === 'string' ? raw['notes'].trim() : '',
    focus: raw['focus'] === true,
    children,
  };
}

/** Parents take their status and progress from their children. */
function rollUp(node: TodoNode): TodoNode {
  if (!node.children.length) return node;
  const children = node.children.map(rollUp);
  const statuses = new Set(children.map((c) => c.status));
  const status: TodoStatus = statuses.size === 1 && !statuses.has('in_progress') ? children[0]!.status : 'in_progress';
  return { ...node, children, status, weight: sumWeight(children), progress: weightedProgress(children) };
}

/** Marks unfinished items whose dependencies (anywhere in the schema) are not done. */
function markBlocked(node: TodoNode, statusById: Map<string, TodoStatus>): TodoNode {
  const blocked = node.status !== 'done' && node.dependsOn.some((dep) => statusById.has(dep) && statusById.get(dep) !== 'done');
  return { ...node, blocked, children: node.children.map((c) => markBlocked(c, statusById)) };
}

function flatten(nodes: TodoNode[]): TodoNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function sumWeight(nodes: TodoNode[]): number {
  return nodes.reduce((sum, n) => sum + n.weight, 0);
}

/** Progress of a set of items, weighted by size, rounded. */
function weightedProgress(nodes: TodoNode[]): number {
  const total = sumWeight(nodes);
  return total ? Math.round(nodes.reduce((sum, n) => sum + n.progress * n.weight, 0) / total) : 0;
}

/** Parses the work schema file (current "tracks" format or the earlier "blocks" format). Null when unusable. */
export function parseTodoTree(raw: string): TodoTree | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const top = Array.isArray(data['tracks']) ? data['tracks'] : Array.isArray(data['blocks']) ? data['blocks'] : null;
  if (!top) return null;
  const rolled = top.flatMap((t, i) => parseNode(t, String(i + 1)) ?? []).map(rollUp);
  const statusById = new Map(flatten(rolled).map((n) => [n.id, n.status]));
  const tracks = rolled.map((t) => markBlocked(t, statusById));
  const leaves = flatten(tracks).filter((n) => !n.children.length);
  return {
    title: typeof data['title'] === 'string' ? data['title'] : '',
    updated: typeof data['updated'] === 'string' ? data['updated'] : '',
    tracks,
    progress: weightedProgress(tracks),
    doneItems: leaves.filter((n) => n.status === 'done').length,
    inProgressItems: leaves.filter((n) => n.status === 'in_progress').length,
    totalItems: leaves.length,
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

/** Appended by the app to every subagent's task, so each subagent keeps its own items in the work schema current. */
export const SUBAGENT_SCHEMA_BRIEF = `<cm-subagent-rules>
Work schema (${TODO_RELATIVE_PATH}), if the project has one: the main agent gave you the ids of the items you work on.
- First thing you do: read the file and set those items to "in_progress" (progress 0). Change nothing else.
- Last thing you do, whether you finished, stopped or failed: read the file again just before, and set only those items' status ("done", or back to "not_started" if the work did not happen), progress and a one-to-three sentence note on where they stand. Change nothing else in the file.
- Name the ids in your final report. If you were given no ids, leave the file alone.
</cm-subagent-rules>`;
