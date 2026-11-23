// Shared vocabulary between main-process modules, the composition root and the renderer.
// Types and a few constants only, never functions or logic, so importing it never couples modules' behaviour.

// ---------- Session configuration ----------

export type SessionKind = 'chat' | 'project' | 'ground-rules';
export type ModelChoice = 'default' | 'opus' | 'sonnet' | 'haiku' | 'fable';
export type PermissionChoice = 'auto' | 'default' | 'acceptEdits' | 'plan';

export const MODEL_CHOICES: readonly ModelChoice[] = ['default', 'opus', 'sonnet', 'haiku', 'fable'];
export const PERMISSION_CHOICES: readonly PermissionChoice[] = ['auto', 'default', 'acceptEdits', 'plan'];

/** Persisted description of one session. Survives app restarts. */
export interface SessionRecord {
  id: string;
  name: string;
  color: string;
  kind: SessionKind;
  cwd: string;
  model: ModelChoice;
  permissionMode: PermissionChoice;
  /** Claude Code's own session id, used to resume. Set after the first `init` event. */
  claudeSessionId?: string;
  createdAt: string;
  archived: boolean;
}

/** Everything session-engine needs to start or resume one Claude Code session. */
export interface SessionStartSpec {
  id: string;
  cwd: string;
  model: ModelChoice;
  permissionMode: PermissionChoice;
  /** Text appended to Claude Code's system prompt (base CLAUDE.md + todo-tree protocol). */
  appendSystemPrompt: string;
  resumeClaudeSessionId?: string;
  initialPrompt?: string;
}

// ---------- Questions and permission requests ----------

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionItem {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface PendingQuestion {
  kind: 'question';
  requestId: string;
  questions: QuestionItem[];
  createdAt: number;
}

export interface PendingPermission {
  kind: 'permission';
  requestId: string;
  toolName: string;
  /** One line, e.g. "Bash: npm test". */
  summary: string;
  /** Longer detail, e.g. the full command or file path. May be empty. */
  detail: string;
  createdAt: number;
}

export type PendingInput = PendingQuestion | PendingPermission;

/** Question text -> chosen label(s) or free text. Multi-select answers are comma-separated. */
export type QuestionAnswers = Record<string, string>;
export type PermissionDecision = 'allow' | 'deny';

// ---------- Usage ----------

export interface UsageWindow {
  /** Percent used, 0–100. */
  utilization: number;
  /** ISO timestamp, or null when unknown. */
  resetsAt: string | null;
}

export interface UsageWindows {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
}

export interface UsageSnapshot extends UsageWindows {
  updatedAt: number;
  source: 'oauth' | 'stream' | 'none';
  error?: string;
}

/** Percent used at which a usage bar turns orange / red. */
export const USAGE_WARN_PCT = 70;
export const USAGE_CRIT_PCT = 90;

// ---------- Todo tree ----------

export type TodoStatus = 'not_started' | 'in_progress' | 'done';

export interface TodoStep {
  id: string;
  title: string;
  status: TodoStatus;
}

export interface TodoBlock {
  id: string;
  title: string;
  status: TodoStatus;
  steps: TodoStep[];
}

export interface TodoTree {
  title: string;
  updated: string;
  blocks: TodoBlock[];
}

// ---------- One-shot structured Claude calls ----------

export interface StructuredRequest {
  prompt: string;
  /** JSON schema the answer must match. */
  schema: Record<string, unknown>;
  model: ModelChoice;
  cwd: string;
  /** Built-in tools the call may use; [] for none. */
  tools: string[];
  maxTurns: number;
}

/** A stateless Claude call returning JSON matching the schema, or null. Created by the root and handed to modules that need one. */
export type StructuredQuery = (request: StructuredRequest) => Promise<unknown>;

/** "Bra att veta": one thing from a finished turn the user should know but might miss. */
export interface HeadsUpNote {
  title: string;
  text: string;
}

// ---------- Events from session-engine (normalised, labelled) ----------

export interface ContextUsage {
  percentage: number;
  totalTokens: number;
  maxTokens: number;
}

export type SessionEvent =
  | { type: 'started'; sessionId: string }
  | { type: 'init'; sessionId: string; claudeSessionId: string; model: string; slashCommands: string[] }
  | { type: 'turn_started'; sessionId: string; prompt: string }
  | { type: 'thinking'; sessionId: string; text: string; agentId?: string }
  | { type: 'text'; sessionId: string; text: string; agentId?: string }
  | { type: 'tool_use'; sessionId: string; toolUseId: string; name: string; summary: string; agentId?: string }
  | { type: 'tool_result'; sessionId: string; toolUseId: string; isError: boolean }
  | { type: 'input_requested'; sessionId: string; pending: PendingInput }
  | { type: 'input_resolved'; sessionId: string; requestId: string; answer: string }
  | { type: 'subagent_started'; sessionId: string; taskId: string; description: string }
  | { type: 'subagent_finished'; sessionId: string; taskId: string }
  | { type: 'notice'; sessionId: string; text: string; level: 'info' | 'warning' }
  | { type: 'compacted'; sessionId: string }
  | { type: 'cleared'; sessionId: string }
  | { type: 'model_changed'; sessionId: string; model: ModelChoice }
  | { type: 'turn_finished'; sessionId: string; result: string; isError: boolean; costUsd: number; durationMs: number }
  | { type: 'rate_limit'; sessionId: string; windows: UsageWindows; rejected: boolean }
  | { type: 'heads_up'; sessionId: string; note: HeadsUpNote }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'exited'; sessionId: string };

// ---------- What the UI shows ----------

export type SessionStatus = 'starting' | 'working' | 'waiting' | 'done' | 'idle' | 'error' | 'stopped';

export interface SessionSummary {
  id: string;
  name: string;
  color: string;
  kind: SessionKind;
  cwd: string;
  model: ModelChoice;
  permissionMode: PermissionChoice;
  status: SessionStatus;
  /** First in-progress todo step, else the latest activity, else ''. */
  currentTask: string;
  /** Main agent (1 while working) plus running subagents. */
  activeAgents: number;
  /** Oldest unanswered question or permission request. */
  pending: PendingInput | null;
  pendingCount: number;
  /** ms epoch when the current turn started; null when no turn is running. */
  turnStartedAt: number | null;
  /** ms epoch when the session was started or resumed in this app run. */
  startedAt: number | null;
  lastError: string | null;
  /** Latest "Bra att veta" note, until dismissed. */
  headsUp: HeadsUpNote | null;
  costUsd: number;
  todo: TodoTree | null;
  /** True when the session is not running but can be resumed. */
  resumable: boolean;
  slashCommands: string[];
}

export type TranscriptEntry =
  | { id: string; kind: 'user'; text: string; at: number }
  | { id: string; kind: 'assistant'; text: string; thinking: string; agentId?: string; at: number }
  | { id: string; kind: 'tool'; name: string; summary: string; status: 'running' | 'ok' | 'error'; thinking: string; agentId?: string; at: number }
  | { id: string; kind: 'question'; text: string; answer: string | null; at: number }
  | { id: string; kind: 'system'; text: string; level: 'info' | 'warning' | 'error'; at: number };

// ---------- Settings ----------

export type DockEdge = 'right' | 'bottom' | 'center';
export const DOCK_EDGES: readonly DockEdge[] = ['right', 'bottom', 'center'];

export interface AppSettings {
  projectsRoot: string;
  doNotDisturb: boolean;
  alertOnDone: boolean;
  /** Review finished turns with a small Haiku call and flag what is worth knowing. */
  headsUpEnabled: boolean;
  dockVisible: boolean;
  dockEdge: DockEdge;
  overlayVisible: boolean;
  defaultModel: ModelChoice;
  defaultPermissionMode: PermissionChoice;
}

// ---------- IPC ----------

export interface NewSessionOptions {
  model: ModelChoice;
  permissionMode: PermissionChoice;
  /** Optional first message to the agent. */
  prompt?: string;
}

export interface LocateResult {
  /** Best matching folder, or null when nothing fits. */
  path: string | null;
  /** All folders under the projects root, for a manual pick. */
  candidates: string[];
  reason: string;
}

/** Renderer -> main requests. `req` is the argument, `res` the resolved value. */
export interface IpcInvokeMap {
  'app:get-state': { req: void; res: { sessions: SessionSummary[]; usage: UsageSnapshot; settings: AppSettings } };
  'session:new-chat': { req: NewSessionOptions & { name?: string }; res: string };
  'session:new-project': { req: NewSessionOptions & { name: string; createGitRepo: boolean }; res: string };
  'session:locate-project': { req: { description: string }; res: LocateResult };
  'session:open-project': { req: NewSessionOptions & { cwd: string; name?: string }; res: string };
  'session:send': { req: { id: string; text: string }; res: void };
  'session:answer': { req: { id: string; requestId: string; answers: QuestionAnswers }; res: void };
  'session:permission': { req: { id: string; requestId: string; decision: PermissionDecision }; res: void };
  'session:interrupt': { req: { id: string }; res: void };
  'session:set-model': { req: { id: string; model: ModelChoice }; res: void };
  'session:context-usage': { req: { id: string }; res: ContextUsage | null };
  'session:resume': { req: { id: string }; res: void };
  'session:archive': { req: { id: string }; res: void };
  'session:rename': { req: { id: string; name: string }; res: void };
  'session:transcript': { req: { id: string }; res: TranscriptEntry[] };
  'session:mark-seen': { req: { id: string }; res: void };
  'session:dismiss-heads-up': { req: { id: string }; res: void };
  'ground-rules:edit': { req: { instructions: string }; res: string };
  'settings:update': { req: Partial<AppSettings>; res: AppSettings };
  'usage:refresh': { req: void; res: void };
  'window:snap': { req: { mode: 'left' | 'right' | 'full' }; res: void };
  'window:show-session': { req: { id: string }; res: void };
  'overlay:set-interactive': { req: { interactive: boolean }; res: void };
}

/** Main -> renderer pushes. */
export interface IpcEventMap {
  'state:sessions': SessionSummary[];
  'state:usage': UsageSnapshot;
  'state:settings': AppSettings;
  'session:transcript-upsert': { id: string; entry: TranscriptEntry };
  /** Replaces a whole transcript, e.g. after saved history was loaded in front of it. */
  'session:transcript-reset': { id: string; entries: TranscriptEntry[] };
  'ui:open-session': { id: string };
}

export type IpcInvokeChannel = keyof IpcInvokeMap;
export type IpcEventChannel = keyof IpcEventMap;

/** The API the preload script exposes as `window.cm`. */
export interface RendererApi {
  invoke<K extends IpcInvokeChannel>(channel: K, req: IpcInvokeMap[K]['req']): Promise<IpcInvokeMap[K]['res']>;
  on<K extends IpcEventChannel>(channel: K, listener: (payload: IpcEventMap[K]) => void): () => void;
}
