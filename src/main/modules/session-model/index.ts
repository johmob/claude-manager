// session-model: pure state. Folds SessionEvents, records and todo trees into the
// SessionSummary cards and TranscriptEntry lists the UI shows. No I/O, no timers.
import { CALLOUT_KINDS, splitAppContext, whenText } from '../../../shared/contracts';
import type {
  OpenQuestion,
  Callout,
  CompactProgress,
  CronCall,
  SessionCron,
  ContextUsage,
  PendingInput,
  SessionEvent,
  SessionRecord,
  SessionStatus,
  SavedQuestions,
  ProjectDrift,
  AgentInfo,
  ScheduledJobView,
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
  /**
   * Ends the wait for a turn's tags without them (the call failed or took too long): the turn's text and
   * questions show as they are. Ignored if a new turn has started since. Returns the entries that changed.
   */
  endTagging(id: string, afterEntryId: string | null): TranscriptEntry[];
  /** Work done on the project outside the app (null: none, or dealt with). */
  setDrift(id: string, drift: ProjectDrift | null): void;
  /** Short labels for the work schema's long titles, by id. */
  setTodoLabels(id: string, labels: Record<string, string>): void;
  /** The project's scheduled jobs as the side panel shows them. */
  setSchedule(id: string, jobs: ScheduledJobView[], problem: string): void;
  /** What the tagger must not ask again: the questions still open from earlier turns, and the ones answered lately. */
  askedQuestions(id: string): { open: string[]; answered: string[] };
  /** Puts back questions left unanswered before a restart. */
  setQuestions(id: string, saved: SavedQuestions): void;
  setMapping(id: string, mapping: boolean): void;
  /** Marks a session as stopped by the usage limit (from its saved record, after a restart). */
  setLimit(id: string, resetsAt: string): void;
  summaries(): SessionSummary[];
  summary(id: string): SessionSummary | undefined;
  transcript(id: string): TranscriptEntry[];
}

const MAX_TRANSCRIPT = 500;
/** How long compacting takes per token in the context before any has been timed (about 45 s for 300k tokens). */
const DEFAULT_COMPACT_MS_PER_TOKEN = 0.15;
const DEFAULT_COMPACT_MS = 60_000;

/** "412k" for 412 345 tokens. */
function kTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** "1:12" for 72 000 ms. */
function minutesText(ms: number): string {
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

interface SessionState {
  record: SessionRecord;
  running: boolean;
  turnActive: boolean;
  unseenDone: boolean;
  pending: PendingInput[];
  subagents: Set<string>;
  /** What each running subagent is: its task, kind, model and progress. */
  subagentInfo: Map<string, AgentInfo>;
  /** Agent calls by tool use id: the model and kind they asked for, until their subagent starts. */
  spawns: Map<string, { model: string; agentType: string }>;
  /** CronCreate calls by tool use id, until their result names the job. */
  cronCalls: Map<string, CronCall>;
  sessionCrons: SessionCron[];
  /** Subagents of the current turn, running or finished (and those still running from earlier turns). */
  turnAgents: Set<string>;
  turnStartedAt: number | null;
  startedAt: number | null;
  compacting: CompactProgress | null;
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
  /** Questions still open from earlier turns the user has not replied to; new ones queue up after them. */
  earlierQuestions: OpenQuestion[];
  /**
   * A finished turn waits for its tags: until they arrive the session still counts as working, and its
   * text and questions are held back, so the turn's end shows all at once.
   */
  tagging: boolean;
  drift: ProjectDrift | null;
  todoLabels: Record<string, string>;
  schedule: ScheduledJobView[];
  scheduleProblem: string;
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
  /** Learned from finished compactions, so the next estimate fits this machine and plan. */
  let compactMsPerToken = DEFAULT_COMPACT_MS_PER_TOKEN;

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
      subagentInfo: new Map(),
      spawns: new Map(),
      cronCalls: new Map(),
      sessionCrons: [],
      turnAgents: new Set(),
      turnStartedAt: null,
      compacting: null,
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
      earlierQuestions: [],
      tagging: false,
      drift: null,
      todoLabels: {},
      schedule: [],
      scheduleProblem: '',
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
     * A finished turn whose agent tagged questions ([!QUESTION]) waits for an answer. Plain text is never read as questions by rules: a cheap model tags the turn afterwards
     * (applyTurnTags), since only reading the text with understanding tells a question from a report.
     */
    const collectQuestions = (): TranscriptEntry[] => {
      // The quick chat is answered right where it is asked.
      if (s.record.kind === 'quick') return [];
      const fresh = s.callouts.slice(s.calloutsBefore);
      s.calloutsBefore = s.callouts.length;
      // A [!QUESTION] is a question as it stands. A [!NOTE] may be an assumption to confirm or just
      // information; the cheap model that tags the turn decides (see applyTurnTags).
      const tagged = fresh.flatMap((c): OpenQuestion[] => (c.kind === 'question' ? [{ kind: 'question', text: calloutText(c), about: '', detail: '', brief: '', options: [] }] : []));
      s.taggedQuestions = tagged;
      // A turn the user did not start (e.g. after a subagent finished) keeps the open questions: they are
      // still unanswered, and its own questions queue up after them.
      s.earlierQuestions = s.questions;
      const asked = mergeQuestions(s.earlierQuestions, tagged, s.answered);
      if (asked.length === s.questions.length) return [];
      s.questions = asked;
      s.questionsId = `${at}-${asked.length}`;
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
      case 'turn_started': {
        const busy = s.turnActive;
        // Replying puts the open questions behind the user: an agent that lists them again is not asking anew.
        // Questions still held back while the last turn is being read were never seen, so they are not answered.
        if (!s.tagging) s.answered = [...s.answered, ...s.questions.map((q) => normalizeQuestion(q.text))].slice(-MAX_ANSWERED);
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
        s.earlierQuestions = [];
        s.calloutsBefore = 0;
        // A new message before the last turn's tags arrived: that turn's text shows as it is.
        // Written while the agent was still busy: it reads it once its current turn is over.
        // What the app added for the agent only is left out; a message the app wrote alone shows as a note.
        const { shown, notes } = splitAppContext(event.prompt);
        if (!shown) return [...release(s), ...system(notes.join(' · '), 'info')];
        return [...release(s), ...add({ kind: 'user', text: shown, ...(busy ? { queued: true } : {}) })];
      }
      case 'thinking':
        markActive('Tänker…');
        s.pendingThinking = s.pendingThinking ? `${s.pendingThinking}\n\n${event.text}` : event.text;
        return [];
      case 'text':
        markActive('Skriver svar…');
        if (!event.agentId) s.turnText = event.text;
        // The main agent's text waits for the turn's tags (the quick chat is never tagged).
        return add({ kind: 'assistant', text: event.text, thinking: takeThinking(), agentId: event.agentId, ...(!event.agentId && s.record.kind !== 'quick' ? { held: true } : {}) });
      case 'tool_use':
        markActive(event.summary ? `${event.name}: ${event.summary}` : event.name);
        if (event.spawn) s.spawns.set(event.toolUseId, event.spawn);
        if (event.cron?.kind === 'create') s.cronCalls.set(event.toolUseId, event.cron);
        if (event.cron?.kind === 'delete') s.sessionCrons = s.sessionCrons.filter((j) => j.id !== (event.cron as { id: string }).id);
        if (event.name === 'AskUserQuestion') return [];
        return add(
          { kind: 'tool', name: event.name, summary: event.summary, status: 'running', thinking: takeThinking(), agentId: event.agentId },
          event.toolUseId,
        );
      case 'tool_result': {
        const call = s.cronCalls.get(event.toolUseId);
        s.cronCalls.delete(event.toolUseId);
        if (call?.kind === 'create' && event.cronJob) s.sessionCrons = [...s.sessionCrons.filter((j) => j.id !== event.cronJob!.id), { id: event.cronJob.id, cron: call.cron, schedule: event.cronJob.schedule, prompt: call.prompt, recurring: call.recurring, durable: call.durable, nextFireAt: event.cronJob.nextFireAt }];
        return update(event.toolUseId, (e) => (e.kind === 'tool' ? { ...e, status: event.isError ? 'error' : 'ok' } : e));
      }
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
      case 'subagent_started': {
        const spawn = event.toolUseId ? s.spawns.get(event.toolUseId) : undefined;
        s.subagentInfo.set(event.taskId, { id: event.taskId, role: 'sub', name: event.description, agentType: event.agentType ?? spawn?.agentType ?? '', model: spawn?.model ?? '', effort: '', contextPercent: null, tokens: null, toolUses: 0, lastTool: '', summary: '' });
        s.subagents.add(event.taskId);
        s.turnAgents.add(event.taskId);
        s.lastActivity = `Subagent: ${event.description}`;
        return [];
      }
      case 'subagent_progress': {
        const info = s.subagentInfo.get(event.taskId);
        if (info) s.subagentInfo.set(event.taskId, { ...info, tokens: event.tokens, toolUses: event.toolUses, lastTool: event.lastTool, summary: event.summary || info.summary });
        return [];
      }
      case 'subagent_finished':
        s.subagents.delete(event.taskId);
        s.subagentInfo.delete(event.taskId);
        return [];
      case 'notice':
        return system(event.text, event.level);
      case 'compacting': {
        if (event.active) {
          if (s.compacting) return [];
          const preTokens = s.context?.totalTokens ?? null;
          s.compacting = { startedAt: at, preTokens, expectedMs: preTokens ? Math.max(10_000, Math.round(preTokens * compactMsPerToken)) : DEFAULT_COMPACT_MS };
          return [];
        }
        const was = s.compacting;
        s.compacting = null;
        return was && event.error ? system(`Komprimeringen misslyckades: ${event.error}`, 'warning') : [];
      }
      case 'compacted': {
        const startedAt = s.compacting?.startedAt;
        s.compacting = null;
        const took = event.durationMs ?? (startedAt !== undefined ? at - startedAt : undefined);
        if (took && event.preTokens) compactMsPerToken = compactMsPerToken * 0.5 + (took / event.preTokens) * 0.5;
        const size = event.preTokens ? `: ${kTokens(event.preTokens)}${event.postTokens ? ` → ${kTokens(event.postTokens)}` : ''} tokens` : '';
        return system(`Konversationen komprimerades${size}${took ? ` på ${minutesText(took)}` : ''}.`, 'info');
      }
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
        const read = markRead(s);
        s.turnAgents = new Set(s.subagents);
        s.turnActive = false;
        s.turnStartedAt = null;
        s.compacting = null;
        s.lastActivity = '';
        s.unseenDone = !event.isError && !event.interrupted;
        // A turn that ran into the usage limit ends like any other; it stays marked as limited, not done.
        if (s.limitResetsAt === null && USAGE_LIMIT_TEXT.test(event.result)) s.limitResetsAt = '';
        s.unseenDone = s.unseenDone && s.limitResetsAt === null;
        s.lastError = s.limitResetsAt !== null ? limitMessage(s.limitResetsAt, new Date(at)) : event.isError ? event.result : null;
        const thinking = takeThinking();
        const leftover = thinking ? add({ kind: 'assistant', text: '', thinking }) : [];
        if (event.interrupted) return [...read, ...leftover, ...release(s), ...system('Avbruten.', 'info')];
        if (event.isError) return [...read, ...leftover, ...release(s), ...system(event.result, 'error')];
        // A turn with text of its own waits for its tags before its end shows; one without has nothing to tag.
        s.tagging = s.record.kind !== 'quick' && s.transcript.some((e) => e.kind === 'assistant' && e.held);
        if (s.tagging) s.lastActivity = 'Läser igenom svaret…';
        return [...read, ...leftover, ...collectQuestions(), ...(s.tagging ? [] : release(s))];
      }
      case 'callout':
        s.callouts.push(event.callout);
        return add({ kind: 'callout', callout: event.callout });
      case 'rate_limit':
        if (!event.rejected) return [];
        s.limitResetsAt = event.resetsAt ?? s.limitResetsAt ?? '';
        s.lastError = limitMessage(s.limitResetsAt, new Date(at));
        return system(s.lastError, 'warning');
      case 'error':
        s.lastError = event.message;
        return system(event.message, 'error');
      case 'exited':
        s.running = false;
        s.compacting = null;
        s.turnActive = false;
        s.turnStartedAt = null;
        s.pending = [];
        s.subagents.clear();
        s.subagentInfo.clear();
        s.spawns.clear();
        s.cronCalls.clear();
        // Session-only jobs end with the session; durable ones Claude Code keeps in its own file.
        s.sessionCrons = s.sessionCrons.filter((j) => j.durable);
        s.turnAgents.clear();
        s.pendingThinking = '';
        s.tagging = false;
        // The card's status already says it stopped; a restart (e.g. a new context window) should not look like a halt.
        return [];
    }
  }

  /** Messages queued while the agent was busy are read once its turn ends. Returns the entries that changed. */
  function markRead(s: SessionState): TranscriptEntry[] {
    const changed: TranscriptEntry[] = [];
    s.transcript = s.transcript.map((e) => {
      if (e.kind !== 'user' || !e.queued) return e;
      const { queued: _queued, ...read } = e;
      changed.push(read);
      return read;
    });
    return changed;
  }

  /** Shows the text a turn held back while it waited for its tags. Returns the entries that changed. */
  function release(s: SessionState): TranscriptEntry[] {
    s.tagging = false;
    const changed: TranscriptEntry[] = [];
    s.transcript = s.transcript.map((e) => {
      if (e.kind !== 'assistant' || !e.held) return e;
      const { held: _held, ...shown } = e;
      changed.push(shown);
      return shown;
    });
    return changed;
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
      currentTask: s.compacting ? 'Komprimerar samtalet…' : ((s.tagging ? s.lastActivity : null) ?? currentTask(s.todo) ?? s.lastActivity),
      activeAgents: (s.turnActive ? 1 : 0) + s.subagents.size,
      agentCount: s.running ? 1 + s.turnAgents.size : 0,
      pending: s.pending[0] ?? null,
      pendingCount: s.pending.length,
      turnStartedAt: s.turnStartedAt,
      startedAt: s.startedAt,
      compacting: s.compacting,
      lastError: s.lastError,
      limitResetsAt: s.limitResetsAt,
      icon: record.icon ?? null,
      drift: s.drift,
      todoLabels: s.todoLabels,
      agents: [
        ...(s.turnActive ? [{ id: 'main', role: 'main' as const, name: 'Huvudagent', agentType: '', model: record.model, effort: record.effort, contextPercent: s.context ? Math.round(s.context.percentage) : null, tokens: null, toolUses: 0, lastTool: '', summary: s.lastActivity }] : []),
        ...s.subagentInfo.values(),
      ],
      schedule: s.schedule,
      sessionCrons: s.sessionCrons,
      scheduleProblem: s.scheduleProblem,
      callouts: [...s.callouts].sort((a, b) => CALLOUT_KINDS.indexOf(a.kind) - CALLOUT_KINDS.indexOf(b.kind)),
      questions: s.tagging ? s.earlierQuestions : s.questions,
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
    // Saved history is never waiting for tags.
    const saved = replay.transcript(id).map(({ held: _held, queued: _queued, ...entry }: TranscriptEntry & { held?: boolean; queued?: boolean }) => ({ ...entry, id: `history:${entry.id}` }) as TranscriptEntry);
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
      s.lastError = limitMessage(resetsAt, new Date(now()));
    },
    setBlocks: (id, blocks) => {
      const s = states.get(id);
      return s ? setBlocks(s, blocks) : [];
    },
    setSchedule: (id, jobs, problem) => {
      const s = states.get(id);
      if (!s) return;
      s.schedule = jobs;
      s.scheduleProblem = problem;
    },
    setTodoLabels: (id, labels) => {
      const s = states.get(id);
      if (s) s.todoLabels = labels;
    },
    setDrift: (id, drift) => {
      const s = states.get(id);
      if (s) s.drift = drift;
    },
    askedQuestions: (id) => {
      const s = states.get(id);
      return { open: (s?.earlierQuestions ?? []).map((q) => q.text), answered: (s?.answered ?? []).slice(-RECENT_ANSWERED) };
    },
    setQuestions: (id, saved) => {
      const s = states.get(id);
      if (!s || s.questions.length) return;
      s.questions = saved.questions;
      s.questionsId = saved.id;
      s.questionsAnswer = saved.answer;
    },
    endTagging: (id, afterEntryId) => {
      const s = states.get(id);
      if (!s || s.turnActive) return [];
      const lastUser = [...s.transcript].reverse().find((e) => e.kind === 'user');
      return (lastUser?.id ?? null) === afterEntryId ? release(s) : [];
    },
    setMapping: (id, mapping) => {
      const s = states.get(id);
      if (s) s.mapping = mapping;
    },
    applyTurnTags: (id, afterEntryId, questions, blocks) => {
      const s = states.get(id);
      if (!s) return [];
      const lastUser = [...s.transcript].reverse().find((e) => e.kind === 'user');
      if (s.turnActive || (lastUser?.id ?? null) !== afterEntryId) {
        // The user wrote again before the tags came, without having seen the turn's questions: they still
        // stand, next to whatever the new turn brings. Its text already shows; it only gets its tags.
        const late = mergeQuestions(s.questions, questions, s.answered);
        if (late.length !== s.questions.length) {
          s.questions = late;
          s.questionsId = `${now()}-${late.length}`;
        }
        return setBlocks(s, blocks);
      }
      // The agent's own question callouts went to the tagger as well, which drops repeats; its list stands.
      const asked = mergeQuestions(s.earlierQuestions, questions, s.answered);
      if (JSON.stringify(asked.map((q) => q.text)) !== JSON.stringify(s.questions.map((q) => q.text))) s.questionsId = `${now()}-${asked.length}`;
      s.questions = asked;
      const tagged = setBlocks(s, blocks);
      const shown = release(s);
      const byId = new Map([...tagged, ...shown].map((e) => [e.id, e]));
      return [...byId.keys()].map((entryId) => s.transcript.find((e) => e.id === entryId)!);
    },
    dismissCallouts: (id) => {
      const s = states.get(id);
      if (s) {
        // Put aside questions count as dealt with: the same question is not asked again.
        s.answered = [...s.answered, ...s.questions.map((q) => normalizeQuestion(q.text))].slice(-MAX_ANSWERED);
        s.callouts = [];
        s.questions = [];
        s.questionsId = '';
        s.questionsAnswer = '';
        s.earlierQuestions = [];
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

/** "Användningsgränsen är nådd. Den återställs kl 14:20." (the day too when it is not today). */
function limitMessage(resetsAt: string, at: Date): string {
  const when = resetsAt ? whenText(resetsAt, at) : '';
  return when ? `Användningsgränsen är nådd. Den återställs ${when}.` : 'Användningsgränsen är nådd.';
}
/** How Claude Code words a turn refused by the usage limit. */
const USAGE_LIMIT_TEXT = /usage limit|hit your (?:usage )?limit|rate limit reached|limit reached\|/i;

function statusOf(s: SessionState): SessionStatus {
  // Still reading through a finished turn: its end shows (done, questions) once that is over.
  if (s.tagging && !s.pending.length) return 'working';
  if (s.limitResetsAt !== null && !s.turnActive && !s.pending.length) return 'limited';
  if (!s.running) return s.lastError ? 'error' : s.questions.length ? 'waiting' : 'stopped';
  if (s.pending.length) return 'waiting';
  if (s.turnActive || s.compacting) return 'working';
  if (s.questions.length) return 'waiting';
  if (s.lastError) return 'error';
  return s.unseenDone ? 'done' : 'idle';
}

const MAX_QUESTIONS = 20;
const MAX_ANSWERED = 200;
/** How many answered questions the tagger is shown, so it does not ask them again. */
const RECENT_ANSWERED = 30;

/** A question reduced to its words: lower case, no punctuation, no trailing note such as "(besvarad)". */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]\s*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Open questions first, then new ones not already among them or answered before. */
function mergeQuestions(open: OpenQuestion[], fresh: OpenQuestion[], answered: string[]): OpenQuestion[] {
  const seen = new Set(open.map((q) => normalizeQuestion(q.text)));
  const added = fresh.filter((q) => {
    const key = normalizeQuestion(q.text);
    if (seen.has(key) || alreadyAnswered(answered, q.text)) return false;
    seen.add(key);
    return true;
  });
  return [...open, ...added].slice(0, MAX_QUESTIONS);
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
