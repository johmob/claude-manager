import { readFileSync, unwatchFile, watchFile } from 'node:fs';
import { join } from 'node:path';
import type { TodoNode, TodoStatus, TodoTree } from '../../../shared/contracts';
import { isRecord } from '../../../shared/guards';

export const TODO_RELATIVE_PATH = '.claude-manager/todo.json';
const POLL_MS = 1000;

export const TODO_PROTOCOL = `# Work schema
Keep a work schema for the project in \`${TODO_RELATIVE_PATH}\` in the project root (create the folder if needed). The user sees it as an org chart: the project on top, parallel tracks below it, each track's items under the track.
- Write it as soon as you know the project: after reading up on it, when asked about its status or plan, or before starting real work. Mark what is already done (judge from the code, git history and docs), what is in progress and what remains. If the file exists, update it instead.
- Read up on the project yourself. Never hand mapping the project, judging what matters or summarising its state to a subagent: that is the main agent's job. Subagents get clearly bounded execution tasks.
- Split the work into parallel tracks by area that can progress independently, e.g. "CAD – housing", "Firmware – controller", "Firmware – sensor node", "Web – result pages". A small job is a single track.
- Give each track an owner: the subagent that works on it, or "main" for yourself. A track is a natural unit to hand to a subagent.
- Organise tracks by area of the project, never by phase or chronology. Give the tree depth: split each item into sub-items for its parts (usually 2-3 levels), so the schema shows the project's structure, not one flat list. Use ids like "fw-a.2" and "fw-a.2.1".
- Keep it easy to take in at a glance. The project title is at most four words. A track's or item's title names the thing in at most five words, a noun phrase such as "SPI driver" or "Display OTA", never a sentence or a description: details go in "notes". Keep at most about seven items on one level; when an area has more, group them into packages (an item with sub-items) by the part of the project they belong to.
- Set "status" ("not_started", "in_progress", "done") on the lowest-level items, and "progress" (0-100) on items in progress. The app computes tracks and parents from their items.
- Give every track and every item "notes": one to three sentences on what it covers, where it stands, what is left, and any open questions or risks. The user clicks an item to read them, so an item without notes shows nothing. Write them for all items when you map the project, write them for every new item, and keep them current like the status.
- When an item needs other items finished first, list their ids in "dependsOn", also across tracks.
- Notice when the work moves into a new area or phase that no existing track covers (for example a new device, a test campaign, documentation, or a change of direction). Before working on it, ask the user with the AskUserQuestion tool whether to open a new track for it: propose its title and owner, and offer adding it under an existing track as the alternative. Small sub-items inside an existing track need no question.
- Exact format:
{
  "title": "What this session is building",
  "updated": "2026-11-23T09:00:00Z",
  "tracks": [
    { "id": "fw-a", "title": "Firmware – controller", "owner": "firmware-a", "notes": "STM32 firmware for the controller board: drivers, protocol to the display, control loop.", "items": [
      { "id": "fw-a.1", "title": "SPI driver", "status": "done", "notes": "DMA-based, tested against the pressure sensor at 8 MHz." },
      { "id": "fw-a.2", "title": "Data protocol", "status": "in_progress", "progress": 40, "notes": "Framing and CRC work on the bench. Retries and versioning are left." } ] },
    { "id": "web", "title": "Web – result pages", "owner": "main", "notes": "Pages that show the measurements live and as history.", "items": [
      { "id": "web.1", "title": "Live chart", "status": "not_started", "dependsOn": ["fw-a.2"], "notes": "Needs the data protocol; open question: how many samples per second to show." } ] }
  ]
}
- Keep it current as you go (including "updated"), and update it before changing direction when the plan changes.
- When the user chooses to focus on a track (for example "we focus on this today"), set "focus": true on that track and work on it first; remove "focus" when the focus ends or moves elsewhere. The app shows focused tracks glowing.
- The schema is also your memory. When the user mentions something in chat that belongs to another item than the one you are working on now (an idea, a requirement, a bug, a decision), add it to that item's notes at once, marked as from the user ("Användaren: …"), and say in one line where you noted it. Create the item if none fits. Read an item's notes before you start on it, and update them once a remark is dealt with.
- Write and update the file yourself, as the main agent: the structure (tracks, items, order, dependencies) is yours alone. It is your own map: plan from it, and refer to items by id (e.g. "fw-a.2") when you report progress. Give every subagent the exact ids and titles of the items it works on; when it finishes one, it sets only that item's status, progress and notes in the file (reading it just before, changing nothing else) and names the ids in its report. Check what it recorded, and record progress in the schema rather than relaying it to the user in chat.
- Skip it only for a plain question that has nothing to do with the project's work.`;

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
  return { ...node, children, status, progress: Math.round(average(children.map((c) => c.progress))) };
}

/** Marks unfinished items whose dependencies (anywhere in the schema) are not done. */
function markBlocked(node: TodoNode, statusById: Map<string, TodoStatus>): TodoNode {
  const blocked = node.status !== 'done' && node.dependsOn.some((dep) => statusById.has(dep) && statusById.get(dep) !== 'done');
  return { ...node, blocked, children: node.children.map((c) => markBlocked(c, statusById)) };
}

function flatten(nodes: TodoNode[]): TodoNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
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
    progress: Math.round(average(tracks.map((t) => t.progress))),
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
