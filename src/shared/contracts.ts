// Shared vocabulary between main-process modules, the composition root and the renderer.
// Types and a few constants only, never functions or logic, so importing it never couples modules' behaviour.

// ---------- Session configuration ----------

/** "quick": the small "Ny chatt" window for quick questions; never a card. */
export type SessionKind = 'chat' | 'project' | 'ground-rules' | 'quick';
export type ModelChoice = 'default' | 'opus' | 'sonnet' | 'haiku' | 'fable';
export type PermissionChoice = 'auto' | 'default' | 'acceptEdits' | 'plan';

export const MODEL_CHOICES: readonly ModelChoice[] = ['default', 'opus', 'sonnet', 'haiku', 'fable'];
/** Reasoning effort; 'default' leaves it to the model (or the user's Claude Code setting). */
export type EffortChoice = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORT_CHOICES: readonly EffortChoice[] = ['default', 'low', 'medium', 'high', 'xhigh', 'max'];
/** How large the conversation may grow before Claude Code compacts it: the model's own window ('auto') or a token count. */
export type ContextWindowChoice = 'auto' | number;
export const CONTEXT_WINDOW_CHOICES: readonly ContextWindowChoice[] = ['auto', 200_000, 400_000, 600_000, 1_000_000];
export const PERMISSION_CHOICES: readonly PermissionChoice[] = ['auto', 'default', 'acceptEdits', 'plan'];

/** Persisted description of one session. Survives app restarts. */
export interface SessionRecord {
  id: string;
  name: string;
  color: string;
  kind: SessionKind;
  cwd: string;
  model: ModelChoice;
  effort: EffortChoice;
  permissionMode: PermissionChoice;
  /** Claude Code's own session id, used to resume. Set after the first `init` event. */
  claudeSessionId?: string;
  createdAt: string;
  archived: boolean;
  /** Shown in Fokus. Set when the user writes to it or opens it; cleared after days without work. */
  focused: boolean;
  /** ISO time of the last message or finished turn. */
  lastActiveAt: string;
  contextWindow: ContextWindowChoice;
  /** Tokens processed in this card's turns (input, output and cache), all turns added up. */
  tokensUsed: number;
  /** Stopped by the usage limit: when it resets ('' unknown), kept across restarts so the session still continues; null otherwise. */
  limitResetsAt: string | null;
  /** Chosen from SESSION_ICONS once the project has a work schema; absent until then (initials show instead). */
  icon?: SessionIconName;
  /** Questions the latest turn left unanswered, kept across restarts; absent when there are none. */
  openQuestions?: SavedQuestions;
  /** The project's git state as the app last saw it (taken when a turn ends); absent for folders without git. */
  mark?: ProjectMark;
}

/** A project's git state: HEAD and a fingerprint of its uncommitted changes. */
export interface ProjectMark {
  head: string;
  changes: string;
}

/** Work done on a project outside the app since its mark. */
export interface ProjectDrift {
  /** The project as it is now. */
  mark: ProjectMark;
  /** New commits; -1 when the history was rewritten and the old HEAD is gone. */
  commits: number;
  /** "abc1234 Message", newest first (at most 30). */
  log: string[];
  /** Files changed by those commits (at most 40) and how many in all. */
  files: string[];
  fileCount: number;
  /** Files with changes not committed. */
  uncommitted: number;
}

export interface SavedQuestions {
  id: string;
  /** The agent's answer they came from. */
  answer: string;
  questions: OpenQuestion[];
}

/** The icons a card can get (lucide names), picked by a cheap model to suit the project. */
export const SESSION_ICONS = [
  'cpu',
  'circuit-board',
  'microchip',
  'cable',
  'plug',
  'battery',
  'zap',
  'radio',
  'wifi',
  'bluetooth',
  'antenna',
  'satellite',
  'cog',
  'wrench',
  'hammer',
  'drill',
  'ruler',
  'box',
  'package',
  'boxes',
  'layers',
  'shapes',
  'cylinder',
  'cone',
  'cuboid',
  'printer',
  'scan',
  'camera',
  'monitor',
  'smartphone',
  'tablet',
  'laptop',
  'server',
  'database',
  'cloud',
  'globe',
  'code',
  'terminal',
  'braces',
  'bug',
  'git-branch',
  'workflow',
  'network',
  'chart-line',
  'chart-bar',
  'chart-pie',
  'gauge',
  'thermometer',
  'droplet',
  'wind',
  'flame',
  'sun',
  'leaf',
  'sprout',
  'tree-pine',
  'mountain',
  'waves',
  'fan',
  'magnet',
  'atom',
  'orbit',
  'flask-conical',
  'microscope',
  'dna',
  'heart-pulse',
  'stethoscope',
  'pill',
  'test-tube',
  'pipette',
  'car',
  'truck',
  'forklift',
  'plane',
  'drone',
  'rocket',
  'ship',
  'bike',
  'train-front',
  'container',
  'map',
  'compass',
  'house',
  'building-2',
  'factory',
  'warehouse',
  'construction',
  'hard-hat',
  'store',
  'shopping-cart',
  'wallet',
  'credit-card',
  'banknote',
  'receipt',
  'file-text',
  'book-open',
  'notebook',
  'newspaper',
  'presentation',
  'kanban',
  'list-checks',
  'clipboard-list',
  'pen-tool',
  'palette',
  'brush',
  'image',
  'film',
  'music',
  'headphones',
  'mic',
  'speaker',
  'gamepad-2',
  'joystick',
  'puzzle',
  'dices',
  'trophy',
  'graduation-cap',
  'briefcase',
  'users',
  'message-square',
  'mail',
  'languages',
  'calendar',
  'clock',
  'timer',
  'hourglass',
  'bell',
  'lock',
  'key',
  'shield',
  'eye',
  'cctv',
  'search',
  'lightbulb',
  'lamp',
  'sparkles',
  'bot',
  'brain',
  'hand',
  'grab',
  'anchor',
  'target',
  'crosshair',
  'flag',
  'tag',
  'scale',
  'weight',
  'calculator',
  'sigma',
  'binary',
  'hard-drive',
  'usb',
  'memory-stick',
  'watch',
  'scissors',
  'paperclip',
  'recycle',
] as const;
export type SessionIconName = (typeof SESSION_ICONS)[number];

/** Everything session-engine needs to start or resume one Claude Code session. */
export interface SessionStartSpec {
  id: string;
  cwd: string;
  model: ModelChoice;
  effort: EffortChoice;
  permissionMode: PermissionChoice;
  contextWindow: ContextWindowChoice;
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

// ---------- Account ----------

/** A model the account can use, with the effort levels it supports ("default" first). */
export interface ModelOption {
  choice: ModelChoice;
  /** As Claude Code names it, e.g. "Opus 5.5"; the default row names the model it stands for. */
  label: string;
  efforts: EffortChoice[];
}

/** What the logged-in account offers, as Claude Code reports it (no tokens used). */
export interface AccountSnapshot {
  /** e.g. "Claude Team", "Claude Max"; null when unknown. */
  plan: string | null;
  models: ModelOption[];
  /** False when Claude Code could not be asked; then every choice is offered. */
  verified: boolean;
}

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

/**
 * Today's use of the plan (local date), as weights (see usageWeight): by the user's sessions, and by the
 * app's own helper calls.
 */
export interface DayUsage {
  date: string;
  sessions: number;
  app: number;
}

/** A call's tokens by kind, as the API reports them. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function tokenUsageOf(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): TokenUsage {
  return { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens };
}

/** All tokens a call processed: input, output, and cache reads and writes. */
export function usageTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite;
}

/**
 * Roughly what a call weighs against the plan's usage limits, which follow what calls cost: tokens
 * weighted like the API prices (cache reads a tenth of input, cache writes 1.25, output five times),
 * times the model's price level (Haiku 1, Sonnet 3, the others 5).
 */
export function usageWeight(u: TokenUsage, model: string): number {
  const level = /haiku/i.test(model) ? 1 : /sonnet/i.test(model) ? 3 : 5;
  return level * (u.input + 1.25 * u.cacheWrite + 0.1 * u.cacheRead + 5 * u.output);
}

/** Percent used at which a usage bar turns yellow / orange / red. */
export const USAGE_NOTICE_PCT = 50;
export const USAGE_WARN_PCT = 70;
export const USAGE_CRIT_PCT = 90;

// ---------- Work schema (the todo tree) ----------

export type TodoStatus = 'not_started' | 'in_progress' | 'done';

/**
 * One item of the work schema. Leaves carry the status and progress the agent wrote; for a node
 * with children both are computed from the children, so parents never contradict their parts.
 */
export interface TodoNode {
  id: string;
  title: string;
  status: TodoStatus;
  /** 0–100. */
  progress: number;
  /** Agent or subagent responsible, e.g. "firmware-a". May be empty. */
  owner: string;
  /** Ids of items that must be done first. */
  dependsOn: string[];
  /** True when some dependency is not done yet. */
  blocked: boolean;
  /** The agent's short description: what the item covers, where it stands, what is left. May be empty. */
  notes: string;
  /** The user chose to focus the work on this (usually a track); it is shown glowing. */
  focus: boolean;
  children: TodoNode[];
}

/** The project's work schema: parallel tracks (CAD, firmware, web …) like branches of an org chart. */
export interface TodoTree {
  title: string;
  updated: string;
  tracks: TodoNode[];
  /** Overall 0–100, the average of the tracks. */
  progress: number;
  doneItems: number;
  /** Lowest-level items in progress. */
  inProgressItems: number;
  totalItems: number;
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

// ---------- Callouts: what the agent tags as worth attention ----------

/** GitHub alert kinds (`> [!WARNING]` …) plus `[!QUESTION]` for questions to the user, most urgent first. */
export type CalloutKind = 'caution' | 'warning' | 'question' | 'important' | 'note' | 'tip';
export const CALLOUT_KINDS: readonly CalloutKind[] = ['caution', 'warning', 'question', 'important', 'note', 'tip'];

export interface Callout {
  kind: CalloutKind;
  /** Short bold title; may be empty. */
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
  | { type: 'effort_changed'; sessionId: string; effort: EffortChoice }
  /** `tokens`: this turn's input, output and cache tokens together. */
  | { type: 'turn_finished'; sessionId: string; result: string; isError: boolean; interrupted: boolean; tokens: number; durationMs: number; usage?: TokenUsage }
  | { type: 'context_usage'; sessionId: string; usage: ContextUsage }
  | { type: 'context_window_changed'; sessionId: string; window: ContextWindowChoice }
  /** `resetsAt` (ISO) is when the window that refused the request opens again, when known. */
  | { type: 'rate_limit'; sessionId: string; windows: UsageWindows; rejected: boolean; resetsAt: string | null }
  | { type: 'callout'; sessionId: string; callout: Callout; agentId?: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'exited'; sessionId: string };

// ---------- What the UI shows ----------

/** "limited": stopped by the usage limit; it continues on its own once the limit resets (unless turned off). */
export type SessionStatus = 'starting' | 'working' | 'waiting' | 'done' | 'idle' | 'error' | 'stopped' | 'limited';

export type OpenQuestionKind = 'question' | 'assumption';

/** Something the agent asked, or assumed and wants confirmed, at the end of a turn. */
export interface OpenQuestion {
  kind: OpenQuestionKind;
  text: string;
  /** What it concerns, so it can be answered on its own: the model, part or work step, e.g. "Handtag v4, kåpan"; empty when unknown. */
  about: string;
  /** The text around it in the answer (its section), e.g. what options A and B are; empty when it stands alone. */
  detail: string;
  /** A short background written by a cheap model after the turn ('' until it arrives). */
  brief: string;
  /** One-click answers the agent offered (e.g. "1", "1b"); empty when it gave none. */
  options: string[];
}

/** The app's own updates from GitHub releases. "off" in development, where there is nothing to update. */
export interface UpdateStatus {
  state: 'off' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';
  /** The running version. */
  version: string;
  /** The newer version found, if any. */
  available: string | null;
  /** 0–100 while downloading. */
  progress: number;
  auto: boolean;
  /** The user chose to install the ready version at the next restart; not asked again for it. */
  deferred: boolean;
  /** Why the last check failed, when state is "error". */
  message: string;
}

/** What the popup window over the screen shows: a session's work schema or its questions. */
export interface PopupView {
  /** "quick": the quick chat, large, for reading long answers (its id is "quick"). */
  kind: 'schema' | 'questions' | 'quick';
  id: string;
}

export interface SessionSummary {
  id: string;
  name: string;
  color: string;
  kind: SessionKind;
  cwd: string;
  model: ModelChoice;
  effort: EffortChoice;
  permissionMode: PermissionChoice;
  status: SessionStatus;
  /** First in-progress todo step, else the latest activity, else ''. */
  currentTask: string;
  /** Main agent (1 while working) plus running subagents. */
  activeAgents: number;
  /** All agents of the current turn: the main agent plus its subagents, working or finished; 0 when not running. */
  agentCount: number;
  /** Oldest unanswered question or permission request. */
  pending: PendingInput | null;
  pendingCount: number;
  /** ms epoch when the current turn started; null when no turn is running. */
  turnStartedAt: number | null;
  /** ms epoch when the session was started or resumed in this app run. */
  startedAt: number | null;
  lastError: string | null;
  /** Callouts from the latest turn, most severe first, until dismissed or the next turn starts. */
  callouts: Callout[];
  /** Stopped by the usage limit: when it resets (ISO), or "" when not known. Null when not limited. */
  limitResetsAt: string | null;
  /** The card's icon; null until one is chosen (initials show instead). */
  icon: SessionIconName | null;
  /** Work done on the project outside the app since the app last saw it; null when none. */
  drift: ProjectDrift | null;
  /** Questions and assumptions the latest turn left for the user; empty once answered or dismissed. */
  questions: OpenQuestion[];
  /** Changes with every turn that leaves new questions, so a set put off can be told from a new one. */
  questionsId: string;
  /** The agent's whole final answer the questions come from, for reading them in context; empty without questions. */
  questionsAnswer: string;
  tokensUsed: number;
  /** How full the context window is, measured after the latest turn; null before the first one. */
  context: ContextUsage | null;
  contextWindow: ContextWindowChoice;
  todo: TodoTree | null;
  /** True when the session is not running but can be resumed. */
  resumable: boolean;
  focused: boolean;
  lastActiveAt: string;
  /** The session's main agent is mapping the project into its work schema (or waiting to). */
  mapping: boolean;
  slashCommands: string[];
}

/**
 * What a block (a paragraph, list, table or code block) of the main agent's text is, as a cheap model
 * reads it after the turn. The UI styles each block by its tag and folds messages that only hold the
 * quiet ones.
 */
export const BLOCK_TAGS = [
  'answer', // a direct answer to what the user asked
  'result', // what was done or built, an outcome
  'pass', // a check, test or verification that passed
  'fail', // something that failed, broke or does not work
  'warning', // a limitation, something skipped, uncertain or worth watching
  'risk', // destructive, irreversible or security-related
  'question', // asks the user to answer or choose
  'assumption', // something taken for granted that the user should confirm
  'decision', // a choice the agent made on its own
  'next', // a suggested next step
  'plan', // what the agent is about to do
  'progress', // routine status along the way
  'background', // explanation, context, reasoning
] as const;
export type BlockTag = (typeof BLOCK_TAGS)[number];
/**
 * From which chat detail a tag shows. Minimal: what needs the user, plus direct answers. Moderate adds
 * outcomes and the agent's own choices. Detailed adds the narration (plans, progress, background).
 */
export const TAG_LEVEL: Record<BlockTag, ChatDetail> = {
  answer: 'minimal',
  question: 'minimal',
  assumption: 'minimal',
  fail: 'minimal',
  risk: 'minimal',
  warning: 'minimal',
  result: 'moderate',
  pass: 'moderate',
  decision: 'moderate',
  next: 'moderate',
  plan: 'detailed',
  progress: 'detailed',
  background: 'detailed',
};
/** Tags that are only narration: dimmed, and a message holding nothing else folds into "Under arbetet". */
export const QUIET_BLOCK_TAGS: readonly BlockTag[] = ['plan', 'progress', 'background'];
/** Whether a tag shows at a chat detail. */
export function tagShows(tag: BlockTag, detail: ChatDetail): boolean {
  return CHAT_DETAILS.indexOf(TAG_LEVEL[tag]) <= CHAT_DETAILS.indexOf(detail);
}

export interface TaggedBlock {
  text: string;
  tag: BlockTag | null;
}

export type TranscriptEntry =
  /** `queued`: sent while the agent was busy; it has not read it yet. */
  | { id: string; kind: 'user'; text: string; queued?: boolean; at: number }
  /**
   * `blocks`: the text split into blocks with their tags, once the turn has been tagged. `held`: written in
   * a turn whose tags have not arrived yet; it stays folded with the work until the turn's end shows at once.
   */
  | { id: string; kind: 'assistant'; text: string; thinking: string; agentId?: string; blocks?: TaggedBlock[]; held?: boolean; at: number }
  | { id: string; kind: 'tool'; name: string; summary: string; status: 'running' | 'ok' | 'error'; thinking: string; agentId?: string; at: number }
  | { id: string; kind: 'question'; text: string; answer: string | null; at: number }
  | { id: string; kind: 'callout'; callout: Callout; at: number }
  | { id: string; kind: 'system'; text: string; level: 'info' | 'warning' | 'error'; at: number };

// ---------- Settings ----------

export type DockEdge = 'right' | 'bottom' | 'center';
export const DOCK_EDGES: readonly DockEdge[] = ['right', 'bottom', 'center'];

/** "night": black, high-contrast, monospace; "standard": the softer dark look. */
export const CHAT_DETAILS = ['minimal', 'moderate', 'detailed'] as const;
export type ChatDetail = (typeof CHAT_DETAILS)[number];

export const THEME_CHOICES = ['night', 'standard'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export interface AppSettings {
  /** Where the user's projects live; empty until chosen (the app then asks, and uses ~/Kod meanwhile). */
  projectsRoot: string;
  doNotDisturb: boolean;
  alertOnDone: boolean;
  dockVisible: boolean;
  dockEdge: DockEdge;
  overlayVisible: boolean;
  /** Start with Windows, in the system tray (installed app only). */
  launchAtLogin: boolean;
  /** Sessions stopped by the usage limit continue on their own once it resets. */
  autoResume: boolean;
  /** Keep Windows from sleeping or turning the display off (agents working overnight). */
  keepAwake: boolean;
  /** Text size in the main window and popups, 1 = 16 px root (Ctrl + plus/minus/0). */
  textScale: number;
  /** Install new versions from GitHub on their own once no session is busy. */
  autoUpdate: boolean;
  theme: ThemeChoice;
  defaultModel: ModelChoice;
  defaultEffort: EffortChoice;
  defaultPermissionMode: PermissionChoice;
}

// ---------- IPC ----------

export interface NewSessionOptions {
  model: ModelChoice;
  effort: EffortChoice;
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

/** What a running terminal session is doing, from Claude Code's process registry. */
export type TerminalStatus = 'busy' | 'idle' | 'waiting' | 'unknown';

/** A Claude Code session started outside the app that can be imported as a card. */
export interface ImportCandidate {
  claudeSessionId: string;
  cwd: string;
  title: string;
  /** ms epoch of the last saved message. */
  lastActivity: number;
  /** Set while the session still runs in a terminal window. */
  terminal: { pid: number; status: TerminalStatus; name: string } | null;
}

/** Renderer -> main requests. `req` is the argument, `res` the resolved value. */
export interface IpcInvokeMap {
  /** Today's use of the plan, for the usage details. */
  'usage:day': { req: void; res: DayUsage };
  'app:get-state': { req: void; res: { sessions: SessionSummary[]; usage: UsageSnapshot; settings: AppSettings; account: AccountSnapshot; update: UpdateStatus } };
  /** Lets the user pick the projects folder; the updated settings, or null when cancelled. */
  'settings:choose-projects-root': { req: void; res: AppSettings | null };
  /** Installs the newer version now (fetching it first if needed); the app restarts. */
  'update:install': { req: void; res: void };
  /** Install the ready version at the next restart instead of now. */
  'update:defer': { req: void; res: void };
  /** Looks for a new version now. */
  'update:check': { req: void; res: void };
  /** Asks the quick chat ("Ny chatt"); starts it on the first question. */
  'quick:ask': { req: { text: string }; res: void };
  /** Starts a new quick-chat conversation with the next question; the answers so far stay on screen. */
  'quick:new': { req: void; res: void };
  /** Clears the quick chat: conversation and answers. */
  'quick:reset': { req: void; res: void };
  'quick:current': { req: void; res: SessionSummary | null };
  /** Opens a link from agent text: web links in the browser, local files and folders in Windows. */
  'shell:open': { req: { target: string }; res: void };
  /** Short versions of the quick chat's long answers, by transcript entry id. */
  'quick:summaries': { req: void; res: Record<string, string> };
  'session:new-project': { req: NewSessionOptions & { name: string; createGitRepo: boolean }; res: string };
  'session:locate-project': { req: { description: string }; res: LocateResult };
  /** Opens a project folder: continues `claudeSessionId` when given, otherwise starts a new conversation there. */
  'session:open-project': { req: NewSessionOptions & { cwd: string; name?: string; claudeSessionId?: string }; res: string };
  /** Saved conversations in one folder (newest first), and the card that already shows that folder, if any. */
  'session:folder-sessions': { req: { cwd: string }; res: { candidates: ImportCandidate[]; existingCardId: string | null } };
  'session:import-candidates': { req: void; res: ImportCandidate[] };
  'session:import': { req: { claudeSessionIds: string[] }; res: void };
  'session:send': { req: { id: string; text: string }; res: void };
  'session:answer': { req: { id: string; requestId: string; answers: QuestionAnswers }; res: void };
  'session:permission': { req: { id: string; requestId: string; decision: PermissionDecision }; res: void };
  'session:interrupt': { req: { id: string }; res: void };
  /** Stops what the agent is doing and has it work on this message instead (or on the one already waiting, without text). */
  'session:redirect': { req: { id: string; text?: string }; res: void };
  'session:set-model': { req: { id: string; model: ModelChoice }; res: void };
  'session:set-effort': { req: { id: string; effort: EffortChoice }; res: void };
  'session:set-context-window': { req: { id: string; window: ContextWindowChoice }; res: void };
  'session:resume': { req: { id: string }; res: void };
  /** Removes the card (stops its session); the project's files and Claude's saved conversation stay. */
  'session:delete': { req: { id: string }; res: void };
  'session:rename': { req: { id: string; name: string }; res: void };
  'session:transcript': { req: { id: string }; res: TranscriptEntry[] };
  'session:mark-seen': { req: { id: string }; res: void };
  'session:set-focus': { req: { id: string; focused: boolean }; res: void };
  /** Has the session's main agent map the project into its work schema; `guidance` may be empty. */
  'session:map-project': { req: { id: string; guidance: string }; res: void };
  /** What to do about work done outside the app: update the schema from the change list, map it anew, or let it be. */
  'session:drift': { req: { id: string; action: 'update' | 'remap' | 'ignore' }; res: void };
  'session:dismiss-callouts': { req: { id: string }; res: void };
  'ground-rules:edit': { req: { instructions: string }; res: string };
  'settings:update': { req: Partial<AppSettings>; res: AppSettings };
  'usage:refresh': { req: void; res: void };
  'window:snap': { req: { mode: 'left' | 'right' | 'full' | 'restore' }; res: void };
  /** Maximises the main window when its content is narrower than `width`. True when it did. */
  'window:ensure-width': { req: { width: number }; res: boolean };
  'window:show-session': { req: { id: string }; res: void };
  'overlay:set-interactive': { req: { interactive: boolean }; res: void };
  /** Grows the overlay to show details under the icons (while hovered), or shrinks it back. */
  /** Shows or hides the area under the overlay row; `wide` makes room for the quick chat. */
  'overlay:set-detail': { req: { open: boolean; wide?: boolean }; res: void };
  /** Lets the overlay take keyboard focus while its quick chat is open (normally it never takes focus). */
  'overlay:set-focus': { req: { focus: boolean }; res: void };
  /** Shows a session's work schema or questions in the popup window over the screen, without the main window. */
  'popup:open': { req: PopupView; res: void };
  'popup:close': { req: void; res: void };
  /** What the popup window shows (asked once when the window has loaded). */
  'popup:current': { req: void; res: PopupView | null };
}

/** Main -> renderer pushes. */
export interface IpcEventMap {
  'state:sessions': SessionSummary[];
  'state:usage': UsageSnapshot;
  'state:settings': AppSettings;
  'state:account': AccountSnapshot;
  'state:update': UpdateStatus;
  /** The quick chat's state (working, pending permission), or null when it has not started. */
  'state:quick': SessionSummary | null;
  'state:quick-summaries': Record<string, string>;
  'session:transcript-upsert': { id: string; entry: TranscriptEntry };
  /** Replaces a whole transcript, e.g. after saved history was loaded in front of it. */
  'session:transcript-reset': { id: string; entries: TranscriptEntry[] };
  'ui:open-session': { id: string };
  /** Tells the popup window what to show. */
  'popup:show': PopupView;
}

export type IpcInvokeChannel = keyof IpcInvokeMap;
export type IpcEventChannel = keyof IpcEventMap;

/** The API the preload script exposes as `window.cm`. */
export interface RendererApi {
  invoke<K extends IpcInvokeChannel>(channel: K, req: IpcInvokeMap[K]['req']): Promise<IpcInvokeMap[K]['res']>;
  on<K extends IpcEventChannel>(channel: K, listener: (payload: IpcEventMap[K]) => void): () => void;
}
