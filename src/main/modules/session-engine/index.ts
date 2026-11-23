// session-engine: runs Claude Code sessions through the Agent SDK and turns raw SDK messages
// into the app's labelled SessionEvents. Holds no UI state; questions and permission requests
// stay pending here until the host answers them.
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionResult, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  ContextUsage,
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

export interface SessionEngine {
  start(spec: SessionStartSpec): void;
  send(id: string, text: string): void;
  answerQuestion(id: string, requestId: string, answers: QuestionAnswers): void;
  resolvePermission(id: string, requestId: string, decision: PermissionDecision): void;
  interrupt(id: string): Promise<void>;
  setModel(id: string, model: ModelChoice): Promise<void>;
  contextUsage(id: string): Promise<ContextUsage | null>;
  isRunning(id: string): boolean;
  stop(id: string): void;
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

    const q = query({
      prompt: inbox,
      options: {
        cwd: spec.cwd,
        model: spec.model === 'default' ? undefined : spec.model,
        permissionMode: spec.permissionMode,
        resume: spec.resumeClaudeSessionId,
        thinking: { type: 'adaptive', display: 'summarized' },
        systemPrompt: { type: 'preset', preset: 'claude_code', append: spec.appendSystemPrompt },
        pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
        stderr: (data) => {
          stderrTail.push(...data.split(/\r?\n/).filter(Boolean));
          stderrTail.splice(0, Math.max(0, stderrTail.length - STDERR_LINES));
        },
        canUseTool: (toolName, input, opts) => requestDecision(spec.id, pending, toolName, input, opts.requestId, opts.signal),
      },
    });

    const live: LiveSession = { q, inbox, pending, stderrTail, stopping: false };
    sessions.set(spec.id, live);
    onEvent({ type: 'started', sessionId: spec.id });
    if (spec.initialPrompt) send(spec.id, spec.initialPrompt);
    void pump(spec.id, live);
  }

  async function pump(id: string, live: LiveSession): Promise<void> {
    try {
      for await (const message of live.q) {
        for (const event of translate(id, message)) onEvent(event);
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
    await sessions.get(id)?.q.interrupt();
  }

  async function setModel(id: string, model: ModelChoice): Promise<void> {
    const live = sessions.get(id);
    if (!live) return;
    await live.q.setModel(model === 'default' ? undefined : model);
    onEvent({ type: 'model_changed', sessionId: id, model });
  }

  async function contextUsage(id: string): Promise<ContextUsage | null> {
    const live = sessions.get(id);
    if (!live) return null;
    const usage = await live.q.getContextUsage();
    return { percentage: usage.percentage, totalTokens: usage.totalTokens, maxTokens: usage.maxTokens };
  }

  function stop(id: string): void {
    const live = sessions.get(id);
    if (!live) return;
    live.stopping = true;
    live.inbox.close();
    live.q.close();
  }

  return {
    start,
    send,
    answerQuestion,
    resolvePermission,
    interrupt,
    setModel,
    contextUsage,
    isRunning: (id) => sessions.has(id),
    stop,
    stopAll: () => [...sessions.keys()].forEach(stop),
  };
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
        if (block.type === 'text' && block.text.trim()) return [{ type: 'text', sessionId, text: block.text, agentId }];
        if (block.type === 'tool_use') {
          const summary = describeTool(block.name, asRecord(block.input));
          return [{ type: 'tool_use', sessionId, toolUseId: block.id, name: block.name, summary: firstLine(summary), agentId }];
        }
        return [];
      });
    }
    case 'user': {
      const content = m.message.content;
      if (typeof content === 'string') return [];
      return content.flatMap((block): SessionEvent[] =>
        block.type === 'tool_result' ? [{ type: 'tool_result', sessionId, toolUseId: block.tool_use_id, isError: block.is_error === true }] : [],
      );
    }
    case 'result':
      return [
        {
          type: 'turn_finished',
          sessionId,
          result: m.subtype === 'success' ? m.result : resultErrorText(m),
          isError: m.is_error,
          costUsd: m.total_cost_usd,
          durationMs: m.duration_ms,
        },
      ];
    case 'conversation_reset':
      return [{ type: 'cleared', sessionId }];
    case 'rate_limit_event': {
      const info = m.rate_limit_info;
      return [{ type: 'rate_limit', sessionId, windows: rateLimitWindows(info), rejected: info.status === 'rejected' }];
    }
    default:
      return [];
  }
}

function translateSystem(sessionId: string, m: Extract<SDKMessage, { type: 'system' }>): SessionEvent[] {
  switch (m.subtype) {
    case 'init':
      return [{ type: 'init', sessionId, claudeSessionId: m.session_id, model: m.model, slashCommands: m.slash_commands }];
    case 'compact_boundary':
      return [{ type: 'compacted', sessionId }];
    case 'task_started':
      return m.task_type === 'local_agent' && !m.ambient ? [{ type: 'subagent_started', sessionId, taskId: m.task_id, description: m.description }] : [];
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

function resultErrorText(m: Extract<SDKMessage, { type: 'result' }>): string {
  const errors = asRecord(m)['errors'];
  const list = Array.isArray(errors) ? errors.filter((e): e is string => typeof e === 'string') : [];
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
