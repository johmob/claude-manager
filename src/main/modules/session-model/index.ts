// session-model: pure state. Folds SessionEvents, records and todo trees into the
// SessionSummary cards and TranscriptEntry lists the UI shows. No I/O, no timers.
import { CALLOUT_KINDS } from '../../../shared/contracts';
import type {
  OpenQuestion,
  Callout,
  ContextUsage,
  PendingInput,
  SessionEvent,
  SessionRecord,
  SessionStatus,
  SessionSummary,
  TodoNode,
  TodoTree,
  TranscriptEntry,
} from '../../../shared/contracts';

export interface SessionModel {
  /** Add a session or update its persisted fields (name, colour, model…). */
  upsertRecord(record: SessionRecord): void;
  remove(id: string): void;
  /** Apply one event. Returns the transcript entries that were created or changed. */
  apply(event: SessionEvent): TranscriptEntry[];
  /**
   * Prepends a saved conversation (as replayed events) to the session's transcript without
   * touching its live status. Returns the full transcript afterwards.
   */
  loadHistory(id: string, events: SessionEvent[]): TranscriptEntry[];
  setTodo(id: string, tree: TodoTree | null): void;
  /** The user has looked at a finished turn: `done` becomes `idle`. */
  markSeen(id: string): void;
  dismissCallouts(id: string): void;
  setMapping(id: string, mapping: boolean): void;
  summaries(): SessionSummary[];
  summary(id: string): SessionSummary | undefined;
  transcript(id: string): TranscriptEntry[];
}

const MAX_TRANSCRIPT = 500;

interface SessionState {
  record: SessionRecord;
  running: boolean;
  turnActive: boolean;
  unseenDone: boolean;
  pending: PendingInput[];
  subagents: Set<string>;
  /** Subagents of the current turn, running or finished (and those still running from earlier turns). */
  turnAgents: Set<string>;
  turnStartedAt: number | null;
  startedAt: number | null;
  lastActivity: string;
  lastError: string | null;
  /** Stopped by the usage limit: when it resets ('' when unknown); null when not limited. Kept until a new turn starts. */
  limitResetsAt: string | null;
  callouts: Callout[];
  /** The main agent's latest text in the current turn; its questions are checked when the turn ends. */
  turnText: string;
  /** What the last turn left for the user to answer or confirm; the session waits while there are any. */
  questions: OpenQuestion[];
  questionsId: string;
  questionsAnswer: string;
  mapping: boolean;
  context: ContextUsage | null;
  todo: TodoTree | null;
  slashCommands: string[];
  transcript: TranscriptEntry[];
  pendingThinking: string;
  /** toolUseId or requestId -> transcript entry id */
  entryFor: Map<string, string>;
  seq: number;
}

export function createSessionModel(now: () => number = Date.now): SessionModel {
  const states = new Map<string, SessionState>();

  function upsertRecord(record: SessionRecord): void {
    const existing = states.get(record.id);
    if (existing) {
      existing.record = record;
      return;
    }
    states.set(record.id, {
      record,
      running: false,
      turnActive: false,
      unseenDone: false,
      pending: [],
      subagents: new Set(),
      turnAgents: new Set(),
      turnStartedAt: null,
      startedAt: null,
      lastActivity: '',
      lastError: null,
      limitResetsAt: null,
      callouts: [],
      turnText: '',
      questions: [],
      questionsId: '',
      questionsAnswer: '',
      mapping: false,
      context: null,
      todo: null,
      slashCommands: [],
      transcript: [],
      pendingThinking: '',
      entryFor: new Map(),
      seq: 0,
    });
  }

  function apply(event: SessionEvent): TranscriptEntry[] {
    const s = states.get(event.sessionId);
    if (!s) return [];
    const at = now();

    const add = (entry: DistributiveOmit<TranscriptEntry, 'id' | 'at'>, key?: string): TranscriptEntry[] => {
      const full = { ...entry, id: `${event.sessionId}:${++s.seq}`, at } as TranscriptEntry;
      s.transcript.push(full);
      if (s.transcript.length > MAX_TRANSCRIPT) s.transcript.splice(0, s.transcript.length - MAX_TRANSCRIPT);
      if (key) s.entryFor.set(key, full.id);
      return [full];
    };
    const update = (key: string, change: (entry: TranscriptEntry) => TranscriptEntry): TranscriptEntry[] => {
      const id = s.entryFor.get(key);
      const index = id ? s.transcript.findIndex((e) => e.id === id) : -1;
      if (index < 0) return [];
      s.entryFor.delete(key);
      s.transcript[index] = change(s.transcript[index]!);
      return [s.transcript[index]!];
    };
    const takeThinking = (): string => {
      const text = s.pendingThinking;
      s.pendingThinking = '';
      return text;
    };
    const markActive = (activity: string): void => {
      s.turnActive = true;
      s.turnStartedAt ??= at;
      if (activity) s.lastActivity = activity;
    };
    const system = (text: string, level: 'info' | 'warning' | 'error'): TranscriptEntry[] => add({ kind: 'system', text, level });
    /**
     * A finished turn that leaves questions or assumptions for the user waits for an answer. Tagged ones
     * ([!QUESTION], and [!NOTE] for assumptions) count as they are; those left as plain text in the final
     * answer (lines ending in "?", lists under question or assumption headings) are also gathered into
     * one box, so they stand out in the transcript. The user answers them all in the question flow.
     */
    const collectQuestions = (): TranscriptEntry[] => {
      const tagged = s.callouts.flatMap((c): OpenQuestion[] =>
        c.kind === 'question' || c.kind === 'note' ? [{ kind: c.kind === 'note' ? 'assumption' : 'question', text: calloutText(c), context: '', detail: '' }] : [],
      );
      const found = findOpenQuestions(s.turnText);
      const seen = new Set<string>();
      s.questions = [...tagged, ...found].filter((q) => !seen.has(q.text) && seen.add(q.text)).slice(0, MAX_QUESTIONS);
      s.questionsId = s.questions.length ? String(at) : '';
      s.questionsAnswer = s.questions.length ? s.turnText : '';
      if (!found.length) return [];
      const assumptions = found.filter((q) => q.kind === 'assumption').length;
      const callout: Callout = {
        kind: 'question',
        title: assumptions === found.length ? 'Antaganden att bekräfta' : found.length === 1 ? 'Fråga till dig' : `${found.length} frågor till dig`,
        text: found.map((q) => `- ${q.kind === 'assumption' && assumptions < found.length ? 'Antagande: ' : ''}${q.text}`).join('\n'),
      };
      s.callouts.push(callout);
      return add({ kind: 'callout', callout });
    };

    switch (event.type) {
      case 'started':
        s.running = true;
        s.startedAt = at;
        s.lastError = null;
        return [];
      case 'init':
        s.slashCommands = event.slashCommands;
        return [];
      case 'turn_started':
        s.limitResetsAt = null;
        s.turnAgents = new Set(s.subagents);
        s.turnActive = true;
        s.turnStartedAt = at;
        s.unseenDone = false;
        s.lastError = null;
        s.lastActivity = '';
        s.callouts = [];
        s.turnText = '';
        s.questions = [];
        s.questionsId = '';
        s.questionsAnswer = '';
        return add({ kind: 'user', text: event.prompt });
      case 'thinking':
        markActive('Tänker…');
        s.pendingThinking = s.pendingThinking ? `${s.pendingThinking}\n\n${event.text}` : event.text;
        return [];
      case 'text':
        markActive('Skriver svar…');
        if (!event.agentId) s.turnText = event.text;
        return add({ kind: 'assistant', text: event.text, thinking: takeThinking(), agentId: event.agentId });
      case 'tool_use':
        markActive(event.summary ? `${event.name}: ${event.summary}` : event.name);
        if (event.name === 'AskUserQuestion') return [];
        return add(
          { kind: 'tool', name: event.name, summary: event.summary, status: 'running', thinking: takeThinking(), agentId: event.agentId },
          event.toolUseId,
        );
      case 'tool_result':
        return update(event.toolUseId, (e) => (e.kind === 'tool' ? { ...e, status: event.isError ? 'error' : 'ok' } : e));
      case 'input_requested': {
        s.pending.push(event.pending);
        if (event.pending.kind === 'question') {
          const text = event.pending.questions.map((q) => q.question).join('\n');
          return add({ kind: 'question', text, answer: null }, event.pending.requestId);
        }
        return [];
      }
      case 'input_resolved': {
        const resolved = s.pending.find((p) => p.requestId === event.requestId);
        s.pending = s.pending.filter((p) => p.requestId !== event.requestId);
        if (resolved?.kind === 'permission') return system(`${event.answer}: ${resolved.summary}`, 'info');
        return update(event.requestId, (e) => (e.kind === 'question' ? { ...e, answer: event.answer } : e));
      }
      case 'subagent_started':
        s.subagents.add(event.taskId);
        s.turnAgents.add(event.taskId);
        s.lastActivity = `Subagent: ${event.description}`;
        return [];
      case 'subagent_finished':
        s.subagents.delete(event.taskId);
        return [];
      case 'notice':
        return system(event.text, event.level);
      case 'compacted':
        return system('Konversationen komprimerades.', 'info');
      case 'cleared':
        return system('Konversationen rensades.', 'info');
      case 'model_changed':
        return system(`Modell bytt till ${event.model}.`, 'info');
      case 'context_usage':
        s.context = event.usage;
        return [];
      case 'context_window_changed':
        return system(`Kontextfönster: ${event.window === 'auto' ? 'modellens eget' : `${Math.round(event.window / 1000)}k tokens`}.`, 'info');
      case 'effort_changed':
        return system(`Effort bytt till ${event.effort}.`, 'info');
      case 'turn_finished': {
        s.turnAgents = new Set(s.subagents);
        s.turnActive = false;
        s.turnStartedAt = null;
        s.lastActivity = '';
        s.unseenDone = !event.isError && !event.interrupted;
        // A turn that ran into the usage limit ends like any other; it stays marked as limited, not done.
        if (s.limitResetsAt === null && USAGE_LIMIT_TEXT.test(event.result)) s.limitResetsAt = '';
        s.unseenDone = s.unseenDone && s.limitResetsAt === null;
        s.lastError = s.limitResetsAt !== null ? LIMIT_MESSAGE : event.isError ? event.result : null;
        const thinking = takeThinking();
        const leftover = thinking ? add({ kind: 'assistant', text: '', thinking }) : [];
        if (event.interrupted) return [...leftover, ...system('Avbruten.', 'info')];
        if (event.isError) return [...leftover, ...system(event.result, 'error')];
        return [...leftover, ...collectQuestions()];
      }
      case 'callout':
        s.callouts.push(event.callout);
        return add({ kind: 'callout', callout: event.callout });
      case 'rate_limit':
        if (!event.rejected) return [];
        s.limitResetsAt = event.resetsAt ?? s.limitResetsAt ?? '';
        s.lastError = LIMIT_MESSAGE;
        return system(s.lastError, 'warning');
      case 'error':
        s.lastError = event.message;
        return system(event.message, 'error');
      case 'exited':
        s.running = false;
        s.turnActive = false;
        s.turnStartedAt = null;
        s.pending = [];
        s.subagents.clear();
        s.turnAgents.clear();
        s.pendingThinking = '';
        // The card's status already says it stopped; a restart (e.g. a new context window) should not look like a halt.
        return [];
    }
  }

  function summarize(s: SessionState): SessionSummary {
    const { record } = s;
    return {
      id: record.id,
      name: record.name,
      color: record.color,
      kind: record.kind,
      cwd: record.cwd,
      model: record.model,
      effort: record.effort,
      permissionMode: record.permissionMode,
      status: statusOf(s),
      currentTask: currentTask(s.todo) ?? s.lastActivity,
      activeAgents: (s.turnActive ? 1 : 0) + s.subagents.size,
      agentCount: s.running ? 1 + s.turnAgents.size : 0,
      pending: s.pending[0] ?? null,
      pendingCount: s.pending.length,
      turnStartedAt: s.turnStartedAt,
      startedAt: s.startedAt,
      lastError: s.lastError,
      limitResetsAt: s.limitResetsAt,
      callouts: [...s.callouts].sort((a, b) => CALLOUT_KINDS.indexOf(a.kind) - CALLOUT_KINDS.indexOf(b.kind)),
      questions: s.questions,
      questionsId: s.questionsId,
      questionsAnswer: s.questionsAnswer,
      tokensUsed: record.tokensUsed,
      context: s.context,
      contextWindow: record.contextWindow,
      todo: s.todo,
      resumable: !s.running,
      focused: record.focused,
      mapping: s.mapping,
      lastActiveAt: record.lastActiveAt,
      slashCommands: s.slashCommands,
    };
  }

  function loadHistory(id: string, events: SessionEvent[]): TranscriptEntry[] {
    const s = states.get(id);
    if (!s) return [];
    const replay = createSessionModel(now);
    replay.upsertRecord(s.record);
    for (const event of events) replay.apply(event);
    const saved = replay.transcript(id).map((entry) => ({ ...entry, id: `history:${entry.id}` }));
    s.transcript = [...saved, ...s.transcript].slice(-MAX_TRANSCRIPT);
    return [...s.transcript];
  }

  return {
    upsertRecord,
    remove: (id) => void states.delete(id),
    apply,
    loadHistory,
    setTodo: (id, tree) => {
      const s = states.get(id);
      if (s) s.todo = tree;
    },
    markSeen: (id) => {
      const s = states.get(id);
      if (s) s.unseenDone = false;
    },
    setMapping: (id, mapping) => {
      const s = states.get(id);
      if (s) s.mapping = mapping;
    },
    dismissCallouts: (id) => {
      const s = states.get(id);
      if (s) {
        s.callouts = [];
        s.questions = [];
        s.questionsId = '';
        s.questionsAnswer = '';
      }
    },
    summaries: () => [...states.values()].map(summarize),
    summary: (id) => {
      const s = states.get(id);
      return s ? summarize(s) : undefined;
    },
    transcript: (id) => [...(states.get(id)?.transcript ?? [])],
  };
}

const LIMIT_MESSAGE = 'Användningsgränsen är nådd.';
/** How Claude Code words a turn refused by the usage limit. */
const USAGE_LIMIT_TEXT = /usage limit|hit your (?:usage )?limit|rate limit reached|limit reached\|/i;

function statusOf(s: SessionState): SessionStatus {
  if (s.limitResetsAt !== null && !s.turnActive && !s.pending.length) return 'limited';
  if (!s.running) return s.lastError ? 'error' : s.questions.length ? 'waiting' : 'stopped';
  if (s.pending.length) return 'waiting';
  if (s.turnActive) return 'working';
  if (s.questions.length) return 'waiting';
  if (s.lastError) return 'error';
  return s.unseenDone ? 'done' : 'idle';
}

const MAX_QUESTIONS = 20;
const QUESTION_END = /\?["”'»)]*$/;
const QUESTION_HEADING = /fråg|question/i;
const ASSUMPTION_HEADING = /antag|assum|rätta|bekräfta|stämmer det/i;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

function clean(text: string): string {
  return text.replace(/^\s*>\s?/, '').replace(/\*\*|__|`/g, '').trim();
}

function calloutText(c: Callout): string {
  return c.title && c.text ? `${c.title}: ${c.text}` : c.title || c.text;
}

/** The text of a heading line: "## Frågor", "**Antaganden:**" or a short line ending in a colon. */
function headingText(raw: string): string | null {
  const match =
    /^\s*#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw) ??
    /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/.exec(raw) ??
    /^\s*(?![-*+]\s|\d+[.)]\s|>)(.{2,80}):\s*$/.exec(raw);
  return match ? clean(match[1]!).replace(/:$/, '').trim() : null;
}

const MAX_DETAIL = 3000;

interface AnswerLine {
  raw: string;
  /** Inside a code block (or a fence line itself). */
  code: boolean;
  heading: string | null;
  /** A real heading (# or a bold line): sections for the text around a question end here, unlike "Two ways:" lines. */
  boundary: boolean;
}

function classifyLines(text: string): AnswerLine[] {
  let inFence = false;
  return text.split(/\r?\n/).map((raw) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      return { raw, code: true, heading: null, boundary: false };
    }
    const boundary = !inFence && (/^\s*#{1,6}\s/.test(raw) || /^\s*(?:\*\*|__).+(?:\*\*|__)\s*:?\s*$/.test(raw));
    return { raw, code: inFence, heading: inFence ? null : headingText(raw), boundary };
  });
}

/** The section a line sits in (between the headings around it), without the line itself: what the user needs to answer it. */
function sectionAround(lines: AnswerLine[], at: number): string {
  let start = at;
  while (start > 0 && !lines[start - 1]!.boundary) start--;
  let end = at + 1;
  while (end < lines.length && !lines[end]!.boundary) end++;
  const detail = lines
    .slice(start, end)
    .filter((_, k) => start + k !== at)
    .map((l) => l.raw)
    .join('\n')
    .trim();
  return detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL)}…` : detail;
}

/**
 * What an answer asks of the user: lines ending in a question mark (with the section around them, so
 * "A or B?" comes with what A and B are), and every item listed under a heading about questions
 * ("Öppna frågor") or assumptions ("Antaganden, rätta om fel"). Code blocks are skipped; a paragraph or
 * another heading ends a list.
 */
export function findOpenQuestions(text: string): OpenQuestion[] {
  const lines = classifyLines(text);
  const found: OpenQuestion[] = [];
  let section: { kind: OpenQuestion['kind']; context: string } | null = null;
  lines.forEach((l, i) => {
    if (l.code || !l.raw.trim()) return;
    if (l.heading !== null && !QUESTION_END.test(l.heading)) {
      section = ASSUMPTION_HEADING.test(l.heading)
        ? { kind: 'assumption', context: l.heading }
        : QUESTION_HEADING.test(l.heading)
          ? { kind: 'question', context: l.heading }
          : null;
      return;
    }
    const item = LIST_ITEM.exec(l.raw);
    const line = clean(item ? item[1]! : l.raw);
    if (item && section) {
      if (line) found.push({ kind: section.kind, text: line, context: section.context, detail: '' });
      return;
    }
    if (!item && !/^\s/.test(l.raw)) section = null;
    if (line.length < 6 || !QUESTION_END.test(line)) return;
    // "Testet gick bra. Ska jag fortsätta?": the question is the last sentence; what came before is background.
    const split = /^(.*[.!:])\s+([^.!:?]*\?["”'»)]*)$/.exec(line);
    const around = sectionAround(lines, i);
    const detail = split ? [split[1]!, around].filter(Boolean).join('\n\n') : around;
    found.push({ kind: 'question', text: split ? split[2]!.trim() : line, context: '', detail });
  });
  return found;
}

/**
 * What is being worked on now: the first in-progress item of each track ("fw-a.2 Protokoll (+1 parallellt)").
 * Falls back to tracks that are partly done when no single item is marked in progress.
 */
function currentTask(tree: TodoTree | null): string | null {
  const tracks = tree?.tracks ?? [];
  const items = tracks.flatMap((track) => inProgressLeaves(track).slice(0, 1));
  const active = items.length ? items : tracks.filter((t) => t.status === 'in_progress');
  if (!active.length) return null;
  const first = `${active[0]!.id} ${active[0]!.title}`;
  return active.length > 1 ? `${first} (+${active.length - 1} parallellt)` : first;
}

function inProgressLeaves(node: TodoNode): TodoNode[] {
  if (node.children.length) return node.children.flatMap(inProgressLeaves);
  return node.status === 'in_progress' ? [node] : [];
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
