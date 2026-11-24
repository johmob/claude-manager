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
  TaggedBlock,
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
  /**
   * A cheap model's tags for the latest turn: its questions (added to the agent's own tagged ones) and the
   * tagged blocks of its messages. Ignored if a new turn has started since (`afterEntryId` is no longer the
   * latest message from the user). Returns the entries that changed.
   */
  applyTurnTags(id: string, afterEntryId: string | null, questions: OpenQuestion[], blocks: Array<{ entryId: string; blocks: TaggedBlock[] }>): TranscriptEntry[];
  /** Puts tagged blocks on assistant entries (e.g. saved tags after a restart). Returns the entries that changed. */
  setBlocks(id: string, blocks: Array<{ entryId: string; blocks: TaggedBlock[] }>): TranscriptEntry[];
  setMapping(id: string, mapping: boolean): void;
  /** Marks a session as stopped by the usage limit (from its saved record, after a restart). */
  setLimit(id: string, resetsAt: string): void;
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
  /** Callouts that came before the latest turn ended; only newer ones are this turn's questions. */
  calloutsBefore: number;
  /** Questions the agent itself tagged ([!QUESTION], [!NOTE]) in the latest turn; they stay when a cheap model re-tags the turn. */
  taggedQuestions: OpenQuestion[];
  /** Questions the user has already replied to in this session (normalised), so a repeat is not asked again. */
  answered: string[];
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
      calloutsBefore: 0,
      taggedQuestions: [],
      answered: [],
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
     * A finished turn whose agent tagged questions ([!QUESTION]) or assumptions to confirm ([!NOTE]) waits
     * for an answer. Plain text is never read as questions by rules: a cheap model tags the turn afterwards
     * (applyTurnTags), since only reading the text with understanding tells a question from a report.
     */
    const collectQuestions = (): TranscriptEntry[] => {
      // The quick chat is answered right where it is asked.
      if (s.record.kind === 'quick') return [];
      const fresh = s.callouts.slice(s.calloutsBefore);
      s.calloutsBefore = s.callouts.length;
      const tagged = fresh.flatMap((c): OpenQuestion[] =>
        c.kind === 'question' || c.kind === 'note' ? [{ kind: c.kind === 'note' ? 'assumption' : 'question', text: calloutText(c), about: '', detail: '', brief: '', options: [] }] : [],
      );
      s.taggedQuestions = tagged;
      const asked = tagged.filter((q) => !alreadyAnswered(s.answered, q.text)).slice(0, MAX_QUESTIONS);
      // A turn the user did not start (e.g. after a subagent finished) without questions leaves the open
      // ones as they are: they are still unanswered. Only new questions replace them.
      if (!asked.length) return [];
      s.questions = asked;
      s.questionsId = String(at);
      s.questionsAnswer = s.turnText;
      return [];
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
        // Replying puts the open questions behind the user: an agent that lists them again is not asking anew.
        s.answered = [...s.answered, ...s.questions.map((q) => normalizeQuestion(q.text))].slice(-MAX_ANSWERED);
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
        s.calloutsBefore = 0;
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

  function setBlocks(s: SessionState, blocks: Array<{ entryId: string; blocks: TaggedBlock[] }>): TranscriptEntry[] {
    const tagged = new Map(blocks.map((b) => [b.entryId, b.blocks]));
    const changed: TranscriptEntry[] = [];
    s.transcript = s.transcript.map((e) => {
      const these = tagged.get(e.id);
      if (e.kind !== 'assistant' || !these) return e;
      const next = { ...e, blocks: these };
      changed.push(next);
      return next;
    });
    return changed;
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
    setLimit: (id, resetsAt) => {
      const s = states.get(id);
      if (!s) return;
      s.limitResetsAt = resetsAt;
      s.lastError = LIMIT_MESSAGE;
    },
    setBlocks: (id, blocks) => {
      const s = states.get(id);
      return s ? setBlocks(s, blocks) : [];
    },
    setMapping: (id, mapping) => {
      const s = states.get(id);
      if (s) s.mapping = mapping;
    },
    applyTurnTags: (id, afterEntryId, questions, blocks) => {
      const s = states.get(id);
      if (!s || s.turnActive) return [];
      const lastUser = [...s.transcript].reverse().find((e) => e.kind === 'user');
      if ((lastUser?.id ?? null) !== afterEntryId) return [];
      const seen = new Set<string>();
      const asked = [...s.taggedQuestions, ...questions]
        .filter((q) => !seen.has(normalizeQuestion(q.text)) && seen.add(normalizeQuestion(q.text)))
        .filter((q) => !alreadyAnswered(s.answered, q.text))
        .slice(0, MAX_QUESTIONS);
      if (JSON.stringify(asked.map((q) => q.text)) !== JSON.stringify(s.questions.map((q) => q.text))) s.questionsId = String(now());
      s.questions = asked;
      return setBlocks(s, blocks);
    },
    dismissCallouts: (id) => {
      const s = states.get(id);
      if (s) {
        s.callouts = [];
        s.questions = [];
        s.questionsId = '';
        s.questionsAnswer = '';
        s.calloutsBefore = 0;
      }
    },
    summaries: () => [...states.values()].filter((s) => s.record.kind !== 'quick').map(summarize),
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
const MAX_ANSWERED = 200;

/** A question reduced to its words: lower case, no punctuation, no trailing note such as "(besvarad)". */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]\s*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether a question was answered already: the same words, or one containing the other when long enough. */
function alreadyAnswered(answered: string[], text: string): boolean {
  const q = normalizeQuestion(text);
  return answered.some((a) => a === q || (Math.min(a.length, q.length) >= 20 && (a.includes(q) || q.includes(a))));
}
function calloutText(c: Callout): string {
  return c.title && c.text ? `${c.title}: ${c.text}` : c.title || c.text;
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
