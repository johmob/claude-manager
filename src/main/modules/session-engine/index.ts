// session-engine: runs Claude Code sessions through the Agent SDK and turns raw SDK messages
// into the app's labelled SessionEvents. Holds no UI state; questions and permission requests
// stay pending here until the host answers them.
import { getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk';
import type { HookCallback, McpServerConfig, PermissionResult, Query, SDKMessage, SDKUserMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  Callout,
  CalloutKind,
  CronCall,
  EffortChoice,
  ModelChoice,
  PermissionDecision,
  QuestionAnswers,
  QuestionItem,
  SessionEvent,
  SessionStartSpec,
  UsageWindow,
  UsageWindows,
} from '../../../shared/contracts';
import { asRecord } from '../../../shared/guards';
import { tokenUsageOf, usageTokens } from '../../../shared/contracts';

export interface SessionEngine {
  start(spec: SessionStartSpec): void;
  send(id: string, text: string): void;
  answerQuestion(id: string, requestId: string, answers: QuestionAnswers): void;
  resolvePermission(id: string, requestId: string, decision: PermissionDecision): void;
  interrupt(id: string): Promise<void>;
  setModel(id: string, model: ModelChoice): Promise<void>;
  setEffort(id: string, effort: EffortChoice): Promise<void>;
  isRunning(id: string): boolean;
  /** Ends the session's process; resolves once it has exited. */
  stop(id: string): Promise<void>;
  stopAll(): void;
}

export interface SessionEngineOptions {
  /** Use this Claude Code executable instead of the one bundled with the SDK. */
  pathToClaudeCodeExecutable?: string;
}

interface PendingDecision {
  kind: 'question' | 'permission';
  input: Record<string, unknown>;
  summary: string;
  resolve: (result: PermissionResult) => void;
}

interface LiveSession {
  q: Query;
  inbox: InputQueue;
  pending: Map<string, PendingDecision>;
  stderrTail: string[];
  stopping: boolean;
  /** Set by interrupt(); the turn's result then reports an interruption rather than an error. */
  interrupting: boolean;
  /** Resolves when the process has exited and the session is gone from the engine. */
  exited: Promise<void>;
  markExited: () => void;
}

/** Async iterable of user messages that stays open until closed, so one process serves many turns. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(text: string): void {
    this.items.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (!this.closed) {
      const next = this.items.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = null;
    }
  }
}

const STDERR_LINES = 20;

export function createSessionEngine(onEvent: (event: SessionEvent) => void, options: SessionEngineOptions = {}): SessionEngine {
  const sessions = new Map<string, LiveSession>();

  function start(spec: SessionStartSpec): void {
    if (sessions.has(spec.id)) return;
    const inbox = new InputQueue();
    const pending = new Map<string, PendingDecision>();
    const stderrTail: string[] = [];
    const sandbox = spec.sandbox;

    const q = query({
      prompt: inbox,
      options: {
        cwd: spec.cwd,
        model: spec.model === 'default' ? undefined : spec.model,
        effort: spec.effort === 'default' ? undefined : spec.effort,
        settings: {
          ...(spec.contextWindow === 'auto' ? {} : { autoCompactWindow: spec.contextWindow }),
          ...(sandbox ? { disableClaudeAiConnectors: true } : {}),
        },
        ...(sandbox ? { tools: sandbox.tools, mcpServers: sandbox.mcpServers as Record<string, McpServerConfig>, strictMcpConfig: true, settingSources: [] } : {}),
        permissionMode: sandbox ? 'default' : spec.permissionMode,
        resume: spec.resumeClaudeSessionId,
        thinking: { type: 'adaptive', display: 'summarized' },
        systemPrompt: { type: 'preset', preset: 'claude_code', append: spec.appendSystemPrompt },
        pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
        stderr: (data) => {
          stderrTail.push(...data.split(/\r?\n/).filter(Boolean));
          stderrTail.splice(0, Math.max(0, stderrTail.length - STDERR_LINES));
        },
        canUseTool: (toolName, input, opts) =>
          sandbox ? Promise.resolve(toPermissionResult(sandboxDecision(sandbox, toolName, input))) : requestDecision(spec.id, pending, toolName, input, opts.requestId, opts.signal),
        ...(spec.subagentBrief ? { hooks: { SubagentStart: [{ hooks: [briefSubagents(spec.subagentBrief)] }] } } : {}),
      },
    });

    let markExited = (): void => undefined;
    const exited = new Promise<void>((resolve) => (markExited = resolve));
    const live: LiveSession = { q, inbox, pending, stderrTail, stopping: false, interrupting: false, exited, markExited };
    sessions.set(spec.id, live);
    onEvent({ type: 'started', sessionId: spec.id });
    if (spec.initialPrompt) send(spec.id, spec.initialPrompt);
    void pump(spec.id, live);
    // Measure right away, so a resumed conversation shows how full its context is before the first message.
    void reportContext(spec.id, live);
  }

  async function pump(id: string, live: LiveSession): Promise<void> {
    try {
      for await (const message of live.q) {
        if (message.type === 'result' && live.interrupting) {
          live.interrupting = false;
          onEvent({ type: 'turn_finished', sessionId: id, result: '', isError: false, interrupted: true, tokens: turnTokens(message), durationMs: message.duration_ms, usage: tokenUsageOf(message.usage) });
          void reportContext(id, live);
          continue;
        }
        for (const event of translate(id, message)) onEvent(event);
        if (message.type === 'result' || (message.type === 'system' && message.subtype === 'compact_boundary')) void reportContext(id, live);
      }
    } catch (error) {
      if (!live.stopping) {
        const detail = live.stderrTail.slice(-3).join(' ');
        onEvent({ type: 'error', sessionId: id, message: [errorText(error), detail].filter(Boolean).join(' – ') });
      }
    } finally {
      for (const [requestId, decision] of live.pending) {
        decision.resolve({ behavior: 'deny', message: 'Sessionen avslutades.', interrupt: true });
        onEvent({ type: 'input_resolved', sessionId: id, requestId, answer: 'Avbruten' });
      }
      live.pending.clear();
      live.inbox.close();
      if (sessions.get(id) === live) {
        sessions.delete(id);
        onEvent({ type: 'exited', sessionId: id });
      }
      live.markExited();
    }
  }

  function requestDecision(
    id: string,
    pending: Map<string, PendingDecision>,
    toolName: string,
    input: Record<string, unknown>,
    requestId: string,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const isQuestion = toolName === 'AskUserQuestion';
      const summary = describeTool(toolName, input);
      pending.set(requestId, { kind: isQuestion ? 'question' : 'permission', input, summary, resolve });
      signal.addEventListener('abort', () => {
        if (!pending.delete(requestId)) return;
        resolve({ behavior: 'deny', message: 'Avbruten.' });
        onEvent({ type: 'input_resolved', sessionId: id, requestId, answer: 'Avbruten' });
      });
      const createdAt = Date.now();
      onEvent({
        type: 'input_requested',
        sessionId: id,
        pending: isQuestion
          ? { kind: 'question', requestId, questions: parseQuestions(input), createdAt }
          : { kind: 'permission', requestId, toolName, summary: summary ? `${toolName}: ${firstLine(summary)}` : toolName, detail: summary, createdAt },
      });
    });
  }

  function takePending(id: string, requestId: string, kind: PendingDecision['kind']): PendingDecision | null {
    const live = sessions.get(id);
    const decision = live?.pending.get(requestId);
    if (!live || !decision || decision.kind !== kind) return null;
    live.pending.delete(requestId);
    return decision;
  }

  function answerQuestion(id: string, requestId: string, answers: QuestionAnswers): void {
    const decision = takePending(id, requestId, 'question');
    if (!decision) return;
    decision.resolve({ behavior: 'allow', updatedInput: { ...decision.input, answers } });
    onEvent({ type: 'input_resolved', sessionId: id, requestId, answer: Object.values(answers).join(' · ') });
  }

  function resolvePermission(id: string, requestId: string, decision: PermissionDecision): void {
    const pending = takePending(id, requestId, 'permission');
    if (!pending) return;
    pending.resolve(
      decision === 'allow'
        ? { behavior: 'allow', updatedInput: pending.input }
        : { behavior: 'deny', message: 'Användaren nekade detta.' },
    );
    onEvent({ type: 'input_resolved', sessionId: id, requestId, answer: decision === 'allow' ? 'Godkänd' : 'Nekad' });
  }

  function send(id: string, text: string): void {
    const live = sessions.get(id);
    if (!live || !text.trim()) return;
    live.inbox.push(text);
    onEvent({ type: 'turn_started', sessionId: id, prompt: text });
  }

  async function interrupt(id: string): Promise<void> {
    const live = sessions.get(id);
    if (!live) return;
    live.interrupting = true;
    await live.q.interrupt();
  }

  async function setModel(id: string, model: ModelChoice): Promise<void> {
    const live = sessions.get(id);
    if (!live) return;
    await live.q.setModel(model === 'default' ? undefined : model);
    onEvent({ type: 'model_changed', sessionId: id, model });
  }

  async function setEffort(id: string, effort: EffortChoice): Promise<void> {
    const live = sessions.get(id);
    if (!live) return;
    // null clears the override, so the model's (or the user's configured) default applies again.
    await live.q.applyFlagSettings({ effortLevel: effort === 'default' ? null : effort });
    onEvent({ type: 'effort_changed', sessionId: id, effort });
  }

  /** Measures how full the context window is (no tokens used) and reports it; skipped once the session ends. */
  async function reportContext(id: string, live: LiveSession): Promise<void> {
    try {
      const usage = await live.q.getContextUsage();
      onEvent({ type: 'context_usage', sessionId: id, usage: { percentage: usage.percentage, totalTokens: usage.totalTokens, maxTokens: usage.maxTokens } });
    } catch {
      // The session ended between the turn and the measurement; there is nothing left to report.
    }
  }

  function stop(id: string): Promise<void> {
    const live = sessions.get(id);
    if (!live) return Promise.resolve();
    live.stopping = true;
    live.inbox.close();
    live.q.close();
    return live.exited;
  }

  return {
    start,
    send,
    answerQuestion,
    resolvePermission,
    interrupt,
    setModel,
    setEffort,
    isRunning: (id) => sessions.has(id),
    stop,
    stopAll: () => [...sessions.keys()].forEach((id) => void stop(id)),
  };
}

// ---------- Callouts ----------

/** Appended to every session's system prompt. Tested on Haiku and Sonnet: tags failures, risks and assumptions; leaves routine success untagged. */
export const CALLOUT_PROTOCOL = `# Tagging what matters
The user skims your final message in an app that renders GitHub alert blocks as coloured callouts.
When something in this turn deserves attention, put it in its own alert block at the end of your final message:
> [!CAUTION]   risky, destructive or irreversible actions; secrets or security problems
> [!WARNING]   something failed, was skipped, or did not work as intended
> [!QUESTION]  a question for the user that does not block your work
> [!IMPORTANT] something the user should know but could easily miss
> [!NOTE]      an assumption the user should confirm or correct
> [!TIP]       a suggested next step
Format: the marker line, then one line starting with "> ": a short bold title of a few words that names the matter and ends with a colon, then one complete sentence starting with a capital letter, e.g. "> **Avtryckaren kopplas strömlös:** Koppla in den med 24 V avslaget och isolera ledarna 6–8 var för sig." The title is never the first half of the sentence. Write the text in Swedish.
Use at most three blocks per message, only when they add something; never tag routine success.
Questions are the exception: never bury a question to the user in running text. Ask it with the AskUserQuestion tool when you need the answer before you continue; otherwise give each question its own [!QUESTION] block. When you end a turn with several questions, ask them with AskUserQuestion (up to four at a time) rather than as a list in your answer. Assumptions the user should confirm or correct count as questions too: give each its own [!NOTE] block instead of a list under a heading. The app collects the questions and assumptions a turn ends with, asks the user one at a time and sends all the answers back to you in one message.
The user runs many agents and reads each question on its own, away from your text: make every question and assumption self-contained, naming the model, part, version or work step it concerns (with the work-schema item id when there is one), e.g. "cad.2 Handtag v4: är skruvarna i kåpan M3?" rather than "Är skruvarna M3?".`;

const ALERT_LINE = /^\s*>\s*\[!(CAUTION|WARNING|QUESTION|IMPORTANT|NOTE|TIP)\]\s*(.*)$/i;
const FENCE_LINE = /^\s*(```|~~~)/;
/** A bold start that stands apart as a title: "**Titel:** text", "**Titel.** Text", "**Titel** – text" or a bold line. */
const BOLD_TITLE = /^\*\*(.+?)\*\*(?:\s*[:.–—-]+\s*|\s*\n\s*|\s*$)([\s\S]*)$/;
const BOLD_TITLE_PUNCTUATED = /^\*\*(.+?[:.])\*\*\s+([\s\S]*)$/;

/** Splits agent text into plain text and the GitHub alert blocks it tagged (ignoring code fences). */
export function splitCallouts(text: string): { text: string; callouts: Callout[] } {
  const kept: string[] = [];
  const callouts: Callout[] = [];
  let inFence = false;
  let open: { kind: CalloutKind; lines: string[] } | null = null;
  const close = (): void => {
    if (open) callouts.push(toCallout(open.kind, open.lines));
    open = null;
  };
  for (const line of text.split(/\r?\n/)) {
    if (!open && FENCE_LINE.test(line)) inFence = !inFence;
    const alert = inFence ? null : ALERT_LINE.exec(line);
    if (alert) {
      close();
      open = { kind: alert[1]!.toLowerCase() as CalloutKind, lines: alert[2] ? [alert[2]] : [] };
    } else if (open && /^\s*>/.test(line)) {
      open.lines.push(line.replace(/^\s*>\s?/, ''));
    } else {
      close();
      kept.push(line);
    }
  }
  close();
  return { text: kept.join('\n').trim(), callouts };
}

function toCallout(kind: CalloutKind, lines: string[]): Callout {
  const body = lines.join('\n').trim();
  // A bold start running on into the sentence ("**…**, och …") is no title; the box shows it whole.
  const titled = BOLD_TITLE.exec(body) ?? BOLD_TITLE_PUNCTUATED.exec(body);
  return titled
    ? { kind, title: titled[1]!.replace(/[:.]$/, '').trim(), text: sentenceCase(titled[2]!.trim()) }
    : { kind, title: '', text: body };
}

/** The text under a callout's title starts a paragraph of its own, so it starts with a capital letter. */
function sentenceCase(text: string): string {
  return text.charAt(0).toLocaleUpperCase('sv-SE') + text.slice(1);
}

function textEvents(sessionId: string, text: string, agentId: string | undefined): SessionEvent[] {
  const split = splitCallouts(text);
  return [
    ...(split.text ? [{ type: 'text', sessionId, text: split.text, agentId } as const] : []),
    ...split.callouts.map((callout) => ({ type: 'callout', sessionId, callout, agentId }) as const),
  ];
}

// ---------- Saved history ----------

const HISTORY_LIMIT = 400;

/**
 * Reads a saved Claude Code transcript (no tokens, local files) and returns it as the same
 * events the live stream produces. After a compaction only the active part is available.
 */
export async function loadHistory(sessionId: string, claudeSessionId: string, cwd: string): Promise<SessionEvent[]> {
  const messages = await getSessionMessages(claudeSessionId, { dir: cwd });
  const questionIds = new Set<string>();
  return messages.slice(-HISTORY_LIMIT).flatMap((m) => historyEvents(sessionId, m, questionIds));
}

function historyEvents(sessionId: string, m: SessionMessage, questionIds: Set<string>): SessionEvent[] {
  const flags = asRecord(m);
  if (flags['isCompactSummary'] === true) return [{ type: 'notice', sessionId, text: 'Tidigare del av konversationen är komprimerad.', level: 'info' }];
  if (m.type === 'system' || flags['is_meta'] === true) return [];
  const content = asRecord(m.message)['content'];
  const blocks = Array.isArray(content) ? content.map(asRecord) : [];

  if (m.type === 'assistant') {
    const live = translate(sessionId, { type: 'assistant', message: m.message, parent_tool_use_id: m.parent_tool_use_id } as SDKMessage);
    const questions = blocks
      .filter((b) => b['type'] === 'tool_use' && b['name'] === 'AskUserQuestion')
      .map((b): SessionEvent => {
        const requestId = String(b['id']);
        questionIds.add(requestId);
        return { type: 'input_requested', sessionId, pending: { kind: 'question', requestId, questions: parseQuestions(asRecord(b['input'])), createdAt: 0 } };
      });
    return [...live, ...questions];
  }

  if (typeof content === 'string') return savedUserText(sessionId, content);
  const text = blocks.filter((b) => b['type'] === 'text').map((b) => String(b['text'] ?? '')).join('\n');
  const results = blocks
    .filter((b) => b['type'] === 'tool_result')
    .map((b): SessionEvent => {
      const toolUseId = String(b['tool_use_id']);
      return questionIds.has(toolUseId)
        ? { type: 'input_resolved', sessionId, requestId: toolUseId, answer: firstLine(toolResultText(b['content'])) }
        : { type: 'tool_result', sessionId, toolUseId, isError: b['is_error'] === true };
    });
  return [...(text.trim() ? savedUserText(sessionId, text) : []), ...results];
}

/** Messages Claude Code itself saves in the user's place; they are never shown as the user's words. */
const MACHINE_TAGS = ['local-command-caveat', 'system-reminder', 'local-command-stderr'];

/**
 * Saved user text also holds slash commands and their local output, and messages Claude Code adds
 * itself (subagent notifications, reminders), wrapped in tags. Only what the user wrote becomes a user message.
 */
export function savedUserText(sessionId: string, text: string): SessionEvent[] {
  const tag = (name: string): string | null => text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null;
  const opening = /^\s*<([a-z-]+)>/.exec(text)?.[1];
  if (opening === 'task-notification') {
    const summary = tag('summary') ?? '';
    const agent = /^Agent "(.+)" (?:finished|completed)/.exec(summary)?.[1];
    const notice = agent ? `Subagenten "${agent}" är klar.` : summary;
    return notice ? [{ type: 'notice', sessionId, text: notice, level: 'info' }] : [];
  }
  if (opening && MACHINE_TAGS.includes(opening)) return [];
  const command = tag('command-name');
  if (command) return [{ type: 'turn_started', sessionId, prompt: [command, tag('command-args')].filter(Boolean).join(' ') }];
  const stdout = tag('local-command-stdout');
  if (stdout !== null) return stdout ? [{ type: 'notice', sessionId, text: stdout, level: 'info' }] : [];
  if (text.startsWith('[Request interrupted')) return [{ type: 'notice', sessionId, text: 'Avbruten av användaren.', level: 'info' }];
  return [{ type: 'turn_started', sessionId, prompt: text }];
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => String(asRecord(b)['text'] ?? '')).join('\n');
}

// ---------- Translation of SDK messages ----------

export function translate(sessionId: string, m: SDKMessage): SessionEvent[] {
  switch (m.type) {
    case 'system':
      return translateSystem(sessionId, m);
    case 'assistant': {
      const agentId = m.parent_tool_use_id ?? undefined;
      return m.message.content.flatMap((block): SessionEvent[] => {
        if (block.type === 'thinking' && block.thinking.trim()) return [{ type: 'thinking', sessionId, text: block.thinking, agentId }];
        if (block.type === 'text') return textEvents(sessionId, block.text, agentId);
        if (block.type === 'tool_use') {
          const input = asRecord(block.input);
          const summary = describeTool(block.name, input);
          // An Agent call carries the model and kind of the subagent it starts.
          const spawn = block.name === 'Agent' || block.name === 'Task' ? { model: typeof input['model'] === 'string' ? input['model'] : '', agentType: typeof input['subagent_type'] === 'string' ? input['subagent_type'] : '' } : undefined;
          const cron = cronCall(block.name, input);
          return [{ type: 'tool_use', sessionId, toolUseId: block.id, name: block.name, summary: firstLine(summary), agentId, ...(spawn ? { spawn } : {}), ...(cron ? { cron } : {}) }];
        }
        return [];
      });
    }
    case 'user': {
      const content = m.message.content;
      if (typeof content === 'string') return [];
      return content.flatMap((block): SessionEvent[] =>
        block.type === 'tool_result' ? [{ type: 'tool_result', sessionId, toolUseId: block.tool_use_id, isError: block.is_error === true, ...cronJobOf(m.tool_use_result) }] : [],
      );
    }
    case 'result':
      return [
        {
          type: 'turn_finished',
          sessionId,
          result: m.subtype === 'success' ? m.result : resultErrorText(m),
          isError: m.is_error,
          interrupted: false,
          tokens: turnTokens(m),
          durationMs: m.duration_ms,
          usage: tokenUsageOf(m.usage),
        },
      ];
    case 'conversation_reset':
      return [{ type: 'cleared', sessionId }];
    case 'rate_limit_event': {
      const info = m.rate_limit_info;
      const resetsAt = typeof info.resetsAt === 'number' ? new Date(info.resetsAt * 1000).toISOString() : null;
      return [{ type: 'rate_limit', sessionId, windows: rateLimitWindows(info), rejected: info.status === 'rejected', resetsAt }];
    }
    default:
      return [];
  }
}

/** What a CronCreate or CronDelete call asks for. */
function cronCall(name: string, input: Record<string, unknown>): CronCall | undefined {
  if (name === 'CronCreate' && typeof input['cron'] === 'string') {
    return { kind: 'create', cron: input['cron'], prompt: typeof input['prompt'] === 'string' ? input['prompt'] : '', recurring: input['recurring'] !== false, durable: input['durable'] === true };
  }
  if (name === 'CronDelete' && typeof input['id'] === 'string') return { kind: 'delete', id: input['id'] };
  return undefined;
}

/** The job a CronCreate call made, from its structured result. */
function cronJobOf(result: unknown): { cronJob?: { id: string; schedule: string; nextFireAt: number | null } } {
  const r = asRecord(result);
  if (typeof r['id'] !== 'string' || typeof r['humanSchedule'] !== 'string') return {};
  return { cronJob: { id: r['id'], schedule: r['humanSchedule'], nextFireAt: typeof r['nextFireAt'] === 'number' ? r['nextFireAt'] : null } };
}

/**
 * A SubagentStart hook that gives every subagent the session starts `brief` as extra context, so rules the
 * subagent must follow reach it even when the main agent forgets to pass them on. The task itself is left as
 * it is (an edited task would be held up by the auto mode's review).
 */
export function briefSubagents(brief: string): HookCallback {
  return async (input) => (input.hook_event_name === 'SubagentStart' ? { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: brief } } : {});
}

function translateSystem(sessionId: string, m: Extract<SDKMessage, { type: 'system' }>): SessionEvent[] {
  switch (m.subtype) {
    case 'init':
      return [{ type: 'init', sessionId, claudeSessionId: m.session_id, model: m.model, slashCommands: m.slash_commands }];
    case 'compact_boundary': {
      const meta = m.compact_metadata;
      return [{ type: 'compacted', sessionId, preTokens: meta.pre_tokens, ...(meta.post_tokens ? { postTokens: meta.post_tokens } : {}), ...(meta.duration_ms ? { durationMs: meta.duration_ms } : {}) }];
    }
    case 'status':
      if (m.status === 'compacting') return [{ type: 'compacting', sessionId, active: true }];
      if (m.status === 'requesting' && !m.compact_result) return [];
      return [{ type: 'compacting', sessionId, active: false, ...(m.compact_result === 'failed' ? { error: m.compact_error || 'okänt fel' } : {}) }];
    case 'task_started':
      return m.task_type === 'local_agent' && !m.ambient
        ? [{ type: 'subagent_started', sessionId, taskId: m.task_id, description: m.description, ...(m.tool_use_id ? { toolUseId: m.tool_use_id } : {}), ...(m.subagent_type ? { agentType: m.subagent_type } : {}) }]
        : [];
    case 'task_progress':
      return [{ type: 'subagent_progress', sessionId, taskId: m.task_id, tokens: m.usage.total_tokens, toolUses: m.usage.tool_uses, lastTool: m.last_tool_name ?? '', summary: typeof m.summary === 'string' ? m.summary : '' }];
    case 'task_notification':
      return [{ type: 'subagent_finished', sessionId, taskId: m.task_id }];
    case 'informational':
      return [{ type: 'notice', sessionId, text: m.content, level: m.level === 'warning' ? 'warning' : 'info' }];
    case 'notification':
      return [{ type: 'notice', sessionId, text: m.text, level: m.priority === 'high' || m.priority === 'immediate' ? 'warning' : 'info' }];
    case 'local_command_output':
      return m.content.trim() ? [{ type: 'notice', sessionId, text: m.content, level: 'info' }] : [];
    case 'api_retry':
      return [{ type: 'notice', sessionId, text: 'API-fel, försöker igen…', level: 'warning' }];
    default:
      return [];
  }
}

type RateLimitInfo = Extract<SDKMessage, { type: 'rate_limit_event' }>['rate_limit_info'];

/** The stream reports utilization as a 0–1 fraction and reset times as epoch seconds. */
function rateLimitWindows(info: RateLimitInfo): UsageWindows {
  const unified = asRecord(asRecord(info)['unifiedWindows']);
  const fromUnified = (key: string): UsageWindow | null => {
    const w = asRecord(unified[key]);
    return typeof w['utilization'] === 'number' ? toWindow(w['utilization'], w['resetsAt']) : null;
  };
  const fromSingle = (key: string): UsageWindow | null =>
    info.rateLimitType === key && typeof info.utilization === 'number' ? toWindow(info.utilization, info.resetsAt) : null;
  return {
    fiveHour: fromUnified('five_hour') ?? fromSingle('five_hour'),
    sevenDay: fromUnified('seven_day') ?? fromSingle('seven_day'),
  };
}

function toWindow(fraction: number, resetsAtSeconds: unknown): UsageWindow {
  return {
    utilization: Math.round(fraction * 1000) / 10,
    resetsAt: typeof resetsAtSeconds === 'number' ? new Date(resetsAtSeconds * 1000).toISOString() : null,
  };
}

/** All tokens a turn processed: input, output, and cache reads and writes. */
function turnTokens(m: Extract<SDKMessage, { type: 'result' }>): number {
  return usageTokens(tokenUsageOf(m.usage));
}

/** Readable error text for a failed turn; Claude Code's internal "[ede_diagnostic] …" lines are left out. */
function resultErrorText(m: Extract<SDKMessage, { type: 'result' }>): string {
  const errors = asRecord(m)['errors'];
  const list = Array.isArray(errors) ? errors.filter((e): e is string => typeof e === 'string' && !e.startsWith('[ede_diagnostic]')) : [];
  return list.length ? list.join('; ') : `Turen avbröts (${m.subtype}).`;
}

// ---------- Helpers ----------

/** Human-readable description of what a tool call does, from its input. Empty when nothing useful. */
export function describeTool(name: string, input: Record<string, unknown>): string {
  const text = (key: string): string => (typeof input[key] === 'string' ? (input[key] as string) : '');
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return text('command');
    case 'Read':
    case 'Write':
    case 'Edit':
      return text('file_path');
    case 'NotebookEdit':
      return text('notebook_path');
    case 'Glob':
    case 'Grep':
      return text('pattern');
    case 'WebFetch':
      return text('url');
    case 'WebSearch':
      return text('query');
    case 'Agent':
    case 'Task':
      return text('description');
    case 'Skill':
      return text('skill');
    case 'ExitPlanMode':
      return text('plan') || 'Planen är klar – godkänn för att börja bygga.';
    default:
      return '';
  }
}

function parseQuestions(input: Record<string, unknown>): QuestionItem[] {
  const raw = Array.isArray(input['questions']) ? input['questions'] : [];
  return raw.map((q) => {
    const item = asRecord(q);
    const options = Array.isArray(item['options']) ? item['options'] : [];
    return {
      question: String(item['question'] ?? ''),
      header: String(item['header'] ?? ''),
      multiSelect: item['multiSelect'] === true,
      options: options.map((o) => {
        const opt = asRecord(o);
        return { label: String(opt['label'] ?? ''), description: String(opt['description'] ?? '') };
      }),
    };
  });
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? '';
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------- Sandbox (the mail agent) ----------

export type SandboxDecision = { allow: true } | { allow: false; message: string };

const SANDBOX_DENIED = 'Inte tillåtet för mejlagenten.';
const SANDBOX_READ_TOOLS = ['Read', 'Glob', 'Grep'];
const SANDBOX_WRITE_TOOLS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', NotebookEdit: 'notebook_path' };

/** Lower-cased, forward-slashed, with "." and ".." resolved; null when the path climbs above its root or is relative. */
function normalizePath(path: string): string | null {
  const slashed = path.replaceAll('\\', '/');
  const drive = /^[a-zA-Z]:/.exec(slashed)?.[0] ?? '';
  const rest = slashed.slice(drive.length);
  if (!rest.startsWith('/')) return null;
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return `${drive}/${parts.join('/')}`.toLowerCase();
}

/** Whether `path` is `root` itself or inside it (case-insensitive, either slash). */
export function isInside(root: string, path: string): boolean {
  const r = normalizePath(root);
  const p = normalizePath(path);
  if (!r || !p) return false;
  const base = r.endsWith('/') ? r : `${r}/`;
  return p === r || p.startsWith(base);
}

/** What a sandboxed session may do; everything not listed is denied, never asked about. */
export function sandboxDecision(sandbox: NonNullable<SessionStartSpec['sandbox']>, toolName: string, input: Record<string, unknown>): SandboxDecision {
  if (toolName.startsWith('mcp__mail__')) return { allow: true };
  // Reads stay inside the thread folder too, so text in a mail cannot lead the agent to other files on the computer.
  if (SANDBOX_READ_TOOLS.includes(toolName)) {
    const target = [input.file_path, input.path, input.pattern].find((v): v is string => typeof v === 'string' && /^([a-z]:|[\\/])/i.test(v));
    return !target || isInside(sandbox.writeRoot, target) ? { allow: true } : { allow: false, message: SANDBOX_DENIED };
  }
  const key = SANDBOX_WRITE_TOOLS[toolName];
  if (key) {
    const path = input[key];
    if (typeof path === 'string' && isInside(sandbox.writeRoot, path)) return { allow: true };
  }
  return { allow: false, message: SANDBOX_DENIED };
}

function toPermissionResult(decision: SandboxDecision): PermissionResult {
  return decision.allow ? { behavior: 'allow' } : { behavior: 'deny', message: decision.message };
}
