// Composition root: the only place that knows every module. It wires modules together with
// callbacks and data, owns persistence of records/settings, and serves the renderer's IPC.
import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from 'electron';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import iconPath from '../../resources/icon.png?asset';
import { appContext, usageWeight, CONTEXT_WINDOW_CHOICES, DOCK_EDGES, EFFORT_CHOICES, MODEL_CHOICES, PERMISSION_CHOICES, SESSION_ICONS, THEME_CHOICES } from '../shared/contracts';
import { isRecord } from '../shared/guards';
import { PASTE_FILE_MAX_BYTES, PASTE_MAX_BYTES, PASTE_TYPES } from '../shared/pastedImages';
/** How long pasted images are kept in the temp folder. */
const PASTE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** Tool calls in a turn that count as real work, after which the work schema should have been touched. */
const SCHEMA_REMINDER_TOOLS = 3;
const SCHEMA_REMINDER = 'Under förra turen arbetade du utan att röra arbetsschemat (.claude-manager/todo.json). Uppdatera det först: markera det som blev klart, sätt pågår bara på det som faktiskt pågår just nu och återställ resten, lägg till det som tillkommit och stryk det som blivit överflödigt. Nämn det inte i chatten.';
import type {
  AppSettings,
  TranscriptEntry,
  UsageSnapshot,
  UsageWindow,
  UpdateStatus,
  EffortChoice,
  ImportCandidate,
  ModelChoice,
  IpcEventChannel,
  IpcEventMap,
  IpcInvokeChannel,
  IpcInvokeMap,
  NewSessionOptions,
  SessionEvent,
  SessionKind,
  OpenQuestion,
  SavedQuestions,
  SessionRecord,
  SessionSummary,
  DayUsage,
  JobRun,
  ScheduledJob,
  TokenUsage,
  TaggedBlock,
  TodoNode,
  TodoTree,
} from '../shared/contracts';
import { CALLOUT_PROTOCOL, createSessionEngine, loadHistory } from './modules/session-engine';
import { createSessionModel } from './modules/session-model';
import { createUsageMonitor } from './modules/usage-monitor';
import { createTodoWatcher, mappingRequest, SUBAGENT_SCHEMA_BRIEF, TODO_PROTOCOL, TODO_RELATIVE_PATH } from './modules/todo-tree';
import { createJsonStore } from './modules/json-store';
import { currentColor, pickColor } from './modules/palette';
import { createGroundRules, groundRulesEditorPrompt } from './modules/ground-rules';
import { createProjects, locateProject } from './modules/projects';
import { createStructuredQuery } from './modules/structured-query';
import { createNotifier } from './modules/notifier';
import { createWindowManager } from './modules/window-manager';
import { createTray } from './modules/tray';
import { importCandidates, liveTerminals } from './modules/terminal-sessions';
import { probeAccount, UNVERIFIED_ACCOUNT } from './modules/account';
import { bringIntoFocus, expireFocus } from './modules/focus-rules';
import { createUpdater } from './modules/updater';
import { createKeepAwake } from './modules/keep-awake';
import { messagesForTagging, questionDetail, readTags, splitBlocks, tagRequest, taggedBlocks } from './modules/turn-tags';
import { createTagMemory } from './modules/tag-memory';
import { iconRequest, readIcon } from './modules/icon-picker';
import { createAppLog } from './modules/app-log';
import { labelRequest, needsLabel, readLabels } from './modules/short-labels';
import { addTokens, localDate, todayOf } from './modules/day-tokens';
import { describeDrift, driftSince, markAt, markOf } from './modules/project-drift';
import { SCHEDULE_PROTOCOL, createScheduler, describeCron, nextRunOf, readJobs, runCommand, writeJobs } from './modules/scheduler';
import { readSummary, SUMMARY_THRESHOLD, summaryRequest } from './modules/answer-summary';
import { compactCheckRequest, readCompactCheck } from './modules/compact-check';
import { registerLocalImageScheme, serveLocalImages } from './modules/local-images';
import { copyToClipboard, mailWithAttachment, outlookPath, saveCopyAs } from './modules/file-actions';

const DEFAULT_SETTINGS: AppSettings = {
  projectsRoot: '',
  doNotDisturb: false,
  alertOnDone: false,
  dockVisible: false,
  dockEdge: 'right',
  overlayVisible: true,
  overlayAnchor: null,
  launchAtLogin: true,
  textScale: 1.1,
  autoUpdate: true,
  autoResume: true,
  logging: true,
  keepAwake: false,
  theme: 'night',
  defaultModel: 'opus',
  defaultEffort: 'medium',
  defaultPermissionMode: 'auto',
};

const SYNC_DELAY_MS = 80;

/** The quick chat ("Ny chatt"): one hidden session, never a card or saved record. */
const QUICK_ID = 'quick';
const QUICK_PROMPT = [
  'Du svarar på snabba frågor, ungefär som en sökning.',
  'Svara på svenska och rakt på sak, utan rubriker om de inte behövs. Svaret får vara så långt som frågan kräver;',
  'en kort sammanfattning görs separat.',
  'Sök på webben när frågan gäller något aktuellt eller fakta du är osäker på, och ange källan kort.',
  'Ställ bara motfrågor när frågan inte går att besvara annars.',
].join(' ');

/** Sent to a session stopped by the usage limit once it has reset. */
const RESUME_MESSAGE =
  'Användningsgränsen har återställts. Fortsätt bara med det arbete som gränsen avbröt, och starta om de subagenter som stoppades av den. Börja inget nytt. Väntar du på ett svar eller ett val från användaren, fortsätt vänta och upprepa kort vad du behöver.';
/** Wait a little past the reset time, so the first request is not refused again. */
const RESUME_MARGIN_MS = 60 * 1000;

/** Given to the app when Windows starts it at login, so it starts in the tray instead of opening its window. */
const AUTOSTART_ARG = '--autostart';

/**
 * Starting the app again with this while it runs makes the running app look for a new version at once
 * (tools/release.mjs does it after publishing); the new process exits, as the app allows one instance.
 */
const CHECK_UPDATE_ARG = '--check-update';

/** A project waiting to be mapped by its session's main agent, with the user's first message held until then. */
interface MappingJob {
  id: string;
  guidance: string;
  firstPrompt?: string;
}

// Same data folder in development and in the installed app (whose name would otherwise differ).
// CLAUDE_MANAGER_DATA_DIR gives a test run its own folder, so it never touches (or locks out) the real app.
/**
 * A test instance (CLAUDE_MANAGER_TEST=1, with its own CLAUDE_MANAGER_DATA_DIR): windows render off screen
 * without focus or taskbar entries, no notifications, no tray icon. Driven over remote debugging.
 */
/** Tells every session where the plan's current usage is, for ground rule 8. */
function usageNote(file: string): string {
  return `# Plan usage\nThe plan's current usage is in ${file.replace(/\\/g, '/')}: percent used of the 5-hour and the weekly limit, and when each resets (updated every few minutes). Read it before you send out subagents or start a large piece of work.`;
}

/** Renderer requests that come with every mouse move or state read; not worth a log line. */
const QUIET_CHANNELS = new Set<string>(['overlay:set-interactive', 'overlay:set-detail', 'overlay:set-focus', 'app:get-state', 'session:transcript', 'usage:day', 'quick:current', 'quick:summaries', 'popup:current', 'session:folder-sessions', 'window:ensure-width']);

/** How often the side panel's schedule (next runs, file changes) is refreshed. */
const SCHEDULE_REFRESH_MS = 30_000;
/** How often the projects are checked for work done outside the app. */
const DRIFT_CHECK_MS = 10 * 60_000;
/** What the agent is asked to do with the change list when the user chooses "Uppdatera schemat". */
const DRIFT_UPDATE_PROMPT = 'Uppdatera arbetsschemat efter detta: läs det som behövs i ändringarna, markera det som blivit klart, lägg till nya punkter för nytt arbete och rätta anteckningarna. Kartlägg inte om hela projektet och börja inget annat arbete. Svara kort med vad du ändrade i schemat.';
/** How long a turn's end waits for its tags before it shows without them. */
const TAG_TIMEOUT_MS = 90_000;
const TEST_INSTANCE = process.env['CLAUDE_MANAGER_TEST'] === '1';
app.setPath('userData', process.env['CLAUDE_MANAGER_DATA_DIR'] || join(app.getPath('appData'), 'claude-manager'));

// Local images agents refer to are shown through an app-only scheme, registered before the app is ready.
registerLocalImageScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(boot);
}

function boot(): void {
  serveLocalImages();
  app.setAppUserModelId('se.johmob.claude-manager');
  const userData = app.getPath('userData');
  const claudeDir = process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude');
  const icon = nativeImage.createFromPath(iconPath);
  let syncTimer: NodeJS.Timeout | null = null;
  /** Mapping turns wait here and run one at a time, so several new projects never map at once. */
  const mappingQueue: MappingJob[] = [];
  /** The mapping now; `restore` (the card's own model and effort) is set once its turn has been sent. */
  let mappingActive: (MappingJob & { restore: { model: ModelChoice; effort: EffortChoice } | null }) | null = null;
  /** Sessions whose new context window applies once the current turn is done. */
  const awaitingRestart = new Set<string>();
  let quitting = false;

  // ---------- Persistence ----------
  const tagMemory = createTagMemory(join(userData, 'tags'));
  /** The plan's current usage, written for the agents to read before they send out subagents. */
  const usageFile = join(userData, 'usage.json');
  const settingsStore = createJsonStore(join(userData, 'settings.json'), DEFAULT_SETTINGS, validSettings);
  const recordStore = createJsonStore<SessionRecord[]>(join(userData, 'sessions.json'), [], validRecords);
  let settings = settingsStore.read();
  let records = recordStore.read();
  const groundRules = createGroundRules(join(userData, 'base-CLAUDE.md'));
  /** The chosen projects folder, or ~/Kod until the user has chosen one. */
  const projectsRoot = (): string => settings.projectsRoot || join(homedir(), 'Kod');
  const projects = createProjects(projectsRoot);

  // ---------- Modules ----------
  const model = createSessionModel();
  /** What the app receives and how it shows it, for analysing problems afterwards (switchable in ⚙). */
  const appLog = createAppLog(join(userData, 'logs'), settings.logging);
  appLog.write('start', { version: app.getVersion() });
  // Cards whose icon is being chosen; declared before the schema watcher, which picks icons from its first read.
  const pickingIcon = new Set<string>();
  // Short labels for long schema titles, kept by title so only new titles go to the cheap model.
  const labelStore = createJsonStore<Record<string, string>>(join(userData, 'schema-labels.json'), {});
  let labelCache = labelStore.read();
  const labelling = new Set<string>();
  // Every Claude process the app starts (sessions and one-shot calls) must use the same executable.
  const claudeExecutable = { pathToClaudeCodeExecutable: packagedClaudeBinary() };
  const engine = createSessionEngine(onSessionEvent, claudeExecutable);
  // Today's use of the plan (weighted by model and cache), split into the user's sessions and the app's own helper calls.
  const dayUsageStore = createJsonStore<DayUsage>(join(userData, 'day-usage.json'), { date: '', sessions: 0, app: 0 });
  let dayUsage = dayUsageStore.read();
  const countUsage = (kind: 'sessions' | 'app', usage: TokenUsage, model: string): void => {
    dayUsage = addTokens(dayUsage, localDate(new Date()), kind, usageWeight(usage, model));
    dayUsageStore.write(dayUsage);
  };
  const structuredQuery = createStructuredQuery({ ...claudeExecutable, onUsage: (usage, model) => countUsage('app', usage, model) });
  // The agent keeps the work schema current itself. A turn that did real work without touching the schema
  // gets a short reminder along with the user's next message (no extra turn, no tokens of its own).
  const turnWork = new Map<string, { since: number; tools: number }>();
  const schemaChangedAt = new Map<string, number>();
  const schemaStale = new Set<string>();
  const todo = createTodoWatcher((id, tree) => {
    schemaChangedAt.set(id, Date.now());
    model.setTodo(id, tree);
    // The map is done once the agent has written it, even if its turn goes on: the card and schema stop
    // saying "Kartlägger". The model switch back and the held first message still wait for the turn's end.
    if (tree && mappingTurn(id)) model.setMapping(id, false);
    if (tree) void pickIcon(id, tree);
    if (tree) void labelSchema(id, tree);
    scheduleSync();
  });
  const usage = createUsageMonitor({
    credentialsPath: join(claudeDir, '.credentials.json'),
    onSnapshot: (snapshot) => {
      pushEvent('state:usage', snapshot);
      markLimitedFromUsage(snapshot);
      saveUsageForAgents(snapshot);
    },
  });
  const windows = createWindowManager({
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererUrl: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
    rendererFile: join(__dirname, '../renderer/index.html'),
    icon,
    onMainClose: confirmClose,
    startHidden: process.argv.includes(AUTOSTART_ARG),
    offscreen: TEST_INSTANCE,
    overlayAnchor: settings.overlayAnchor,
    onOverlayMoved: (overlayAnchor) => {
      settings = { ...settings, overlayAnchor };
      settingsStore.write(settings);
    },
  });
  const notifier = createNotifier({ onClick: showSession, flash: (on) => windows.flash(on), muted: TEST_INSTANCE });
  // A test instance has no tray icon: it must not be mistaken for the user's app.
  const tray = TEST_INSTANCE ? { setWaiting: () => undefined, setLaunchAtLogin: () => undefined, destroy: () => undefined } : createTray({
    icon,
    onOpen: () => windows.showMain(),
    onQuit: quit,
    launchAtLogin: settings.launchAtLogin,
    onLaunchAtLogin: (on) => updateSettings({ launchAtLogin: on }),
  });
  applyLaunchAtLogin();
  windows.setTheme(settings.theme);
  const keepAwake = createKeepAwake();
  keepAwake.set(settings.keepAwake);
  // Only the installed app updates itself; a development run has nothing to install.
  const updater = app.isPackaged
    ? createUpdater({
        version: app.getVersion(),
        auto: settings.autoUpdate,
        onStatus: (status) => {
          appLog.write('update', { ...status });
          pushEvent('state:update', status);
        },
      })
    : null;
  const updateStatus = (): UpdateStatus =>
    updater?.current() ?? { state: 'off', version: app.getVersion(), available: null, progress: 0, auto: settings.autoUpdate, message: 'Uppdateringar finns bara i den installerade appen.' };

  for (const record of activeRecords()) {
    model.upsertRecord(record);
    todo.watch(record.id, record.cwd);
    loadSavedHistory(record);
    // A session stopped by the usage limit before a restart still continues once it resets.
    if (record.limitResetsAt !== null) model.setLimit(record.id, record.limitResetsAt);
    // Questions left unanswered before a restart still wait for the user.
    if (record.openQuestions) model.setQuestions(record.id, record.openQuestions);
  }
  // Work done on the projects outside the app, now and every little while.
  void checkDrift();
  setInterval(() => void checkDrift(), DRIFT_CHECK_MS);
  // Scheduled jobs: run when due, and shown in Fokus with their next and last runs.
  const jobRunsStore = createJsonStore<Record<string, JobRun>>(join(userData, 'job-runs.json'), {});
  let jobRuns = jobRunsStore.read();
  // One run per project folder, even when several cards show the same project.
  createScheduler({ projects: () => [...new Map(activeRecords().filter((r) => r.kind !== 'quick').map((r) => [r.cwd.toLowerCase(), { sessionId: r.id, cwd: r.cwd }])).values()], onDue: (sessionId, cwd, job) => void runJob(sessionId, cwd, job) });
  refreshSchedules();
  setInterval(refreshSchedules, SCHEDULE_REFRESH_MS);
  notifier.setDoNotDisturb(settings.doNotDisturb);
  usage.start();
  // Sessions without work for days leave Fokus: checked at start and then every hour.
  const expireStale = (): void => saveRecords(expireFocus(records, Date.now()));
  expireStale();
  const focusTimer = setInterval(expireStale, 60 * 60 * 1000);
  const resumeTimer = setInterval(resumeAfterLimit, 60 * 1000);
  let account = UNVERIFIED_ACCOUNT;
  probeAccount({ cwd: userData, ...claudeExecutable })
    .then((found) => {
      account = found;
      pushEvent('state:account', found);
    })
    .catch((error: unknown) => console.warn('Kontot kunde inte läsas; alla modeller visas', error));
  scheduleSync();

  app.on('second-instance', (_event, argv) => {
    if (argv.includes(CHECK_UPDATE_ARG)) updater?.checkNow();
    else windows.showMain();
  });
  app.on('before-quit', quit);

  // ---------- Event flow ----------
  /** Sends a changed transcript entry to the windows, and logs how it shows. */
  function showEntry(id: string, entry: TranscriptEntry): void {
    appLog.write('entry', {
      sessionId: id,
      id: entry.id,
      entryKind: entry.kind,
      ...(entry.kind === 'assistant' ? { text: entry.text, agentId: entry.agentId, held: entry.held === true, tags: entry.blocks?.map((b) => b.tag) ?? null } : {}),
      ...(entry.kind === 'user' ? { text: entry.text, queued: entry.queued === true } : {}),
      ...(entry.kind === 'system' ? { text: entry.text, level: entry.level } : {}),
      ...(entry.kind === 'callout' ? { callout: entry.callout } : {}),
      ...(entry.kind === 'tool' ? { name: entry.name, summary: entry.summary, status: entry.status } : {}),
    });
    pushEvent('session:transcript-upsert', { id, entry });
  }

  const cardLog = new Map<string, string>();
  /** Logs a card when what it shows changes: status, what it is doing, its questions. */
  function logCards(summaries: SessionSummary[]): void {
    for (const s of summaries) {
      const shown = { status: s.status, currentTask: s.currentTask, activeAgents: s.activeAgents, questions: s.questions.map((q) => `${q.kind}: ${q.text}`), lastError: s.lastError, drift: s.drift ? { commits: s.drift.commits, files: s.drift.fileCount, uncommitted: s.drift.uncommitted } : null };
      const key = JSON.stringify(shown);
      if (cardLog.get(s.id) === key) continue;
      cardLog.set(s.id, key);
      appLog.write('card', { sessionId: s.id, name: s.name, ...shown });
    }
  }

  function onSessionEvent(event: SessionEvent): void {
    // Everything an agent sends (context readings are frequent and left out).
    if (event.type !== 'context_usage') appLog.write('event', { ...event });
    for (const entry of model.apply(event)) showEntry(event.sessionId, entry);
    rememberLimit(event.sessionId);
    const record = findRecord(event.sessionId);
    switch (event.type) {
      case 'init':
        if (record && record.claudeSessionId !== event.claudeSessionId) saveRecord({ ...record, claudeSessionId: event.claudeSessionId });
        break;
      case 'turn_started':
        // Writing to a session is working on it: it becomes active now and moves into Fokus.
        if (record) {
          saveRecord({ ...record, lastActiveAt: new Date().toISOString() });
          focus(record.id);
        }
        notifier.clear(event.sessionId);
        break;
      // The mapping turn's own model and effort are temporary and never saved to the card.
      case 'model_changed':
        if (record && !mappingTurn(record.id)) saveRecord({ ...record, model: event.model });
        break;
      case 'effort_changed':
        if (record && !mappingTurn(record.id)) saveRecord({ ...record, effort: event.effort });
        break;
      case 'input_requested':
        notifier.alert({
          sessionId: event.sessionId,
          title: `${record?.name ?? 'Session'} väntar på dig`,
          body: event.pending.kind === 'question' ? event.pending.questions.map((q) => q.question).join('\n') : event.pending.summary,
          urgent: true,
        });
        break;
      case 'input_resolved':
      case 'exited':
        if (!model.summary(event.sessionId)?.pendingCount) notifier.clear(event.sessionId);
        // A mapping waiting for this session starts now; one whose turn was running ends with the process.
        if (event.type === 'exited' && mappingActive?.id === event.sessionId) void (mappingActive.restore ? endMapping('stopped') : sendMappingTurn());
        break;
      case 'tool_use': {
        const work = turnWork.get(event.sessionId) ?? { since: Date.now(), tools: 0 };
        turnWork.set(event.sessionId, { ...work, tools: work.tools + 1 });
        break;
      }
      case 'turn_finished': {
        const work = turnWork.get(event.sessionId);
        turnWork.delete(event.sessionId);
        if (work && work.tools >= SCHEMA_REMINDER_TOOLS && record && record.kind !== 'quick' && !mappingTurn(record.id) && hasSchema(record.cwd) && (schemaChangedAt.get(record.id) ?? 0) < work.since) schemaStale.add(record.id);
        if (record) saveRecord({ ...record, lastActiveAt: new Date().toISOString(), tokensUsed: record.tokensUsed + event.tokens });
        void stampMark(event.sessionId);
        if (event.usage) countUsage('sessions', event.usage, record?.model ?? 'default');
        const completed = !event.isError && !event.interrupted;
        if (event.sessionId === QUICK_ID) {
          if (completed) void summarizeQuickAnswer();
          break;
        }
        // The turn's end (questions, done) is announced once its tags are in.
        // A turn that was the agent's preparation for compacting: judged once its tags are in, so the answer is not shown untagged.
        const preparing = model.summary(event.sessionId)?.compactCheck?.state === 'preparing';
        if (preparing && !completed) model.setCompactCheck(event.sessionId, null);
        if (completed) void tagTurn(event.sessionId, event.result).then(() => (preparing ? checkCompact(event.sessionId, event.result) : undefined));
        if (awaitingRestart.delete(event.sessionId)) void restart(event.sessionId);
        if (mappingActive?.id === event.sessionId) void (mappingActive.restore ? endMapping(event.interrupted ? 'interrupted' : 'done') : sendMappingTurn());
        break;
      }
      case 'rate_limit':
        usage.ingest(event.windows);
        break;
    }
    scheduleSync();
  }

  function scheduleSync(): void {
    syncTimer ??= setTimeout(() => {
      syncTimer = null;
      const summaries = model.summaries();
      pushEvent('state:sessions', summaries);
      windows.setDock(settings.dockVisible, settings.dockEdge, summaries.length);
      windows.setOverlay(settings.overlayVisible, summaries.length + 1);
      tray.setWaiting(summaries.filter((s) => s.status === 'waiting').length);
      pushEvent('state:quick', model.summary(QUICK_ID) ?? null);
      rememberQuestions(summaries);
      logCards(summaries);
    }, SYNC_DELAY_MS);
  }

  // ---------- Sessions ----------
  function activeRecords(): SessionRecord[] {
    return records.filter((r) => !r.archived);
  }

  function findRecord(id: string): SessionRecord | undefined {
    return records.find((r) => r.id === id);
  }

  function saveRecord(record: SessionRecord): void {
    saveRecords([record]);
  }

  /** Replaces the given records (keeping their order in the list), writes the file once and updates the cards. */
  function saveRecords(changed: SessionRecord[]): void {
    if (!changed.length) return;
    const byId = new Map(changed.map((r) => [r.id, r]));
    records = [...records.map((r) => byId.get(r.id) ?? r), ...changed.filter((c) => !records.some((r) => r.id === c.id))];
    recordStore.write(records);
    for (const record of changed) {
      if (record.archived) model.remove(record.id);
      else model.upsertRecord(record);
    }
    scheduleSync();
  }

  /** Restarts a running session with its saved settings, continuing the same conversation. */
  async function restart(id: string): Promise<void> {
    await engine.stop(id);
    run(requireRecord(id), undefined);
  }

  /** Sends a message to a session, starting (resuming) it first when it is not running. */
  /** A message from the user. Work done outside the app since the agent last worked here goes along with it. */
  function sendFromUser(id: string, text: string): void {
    // A slash command (/compact, /clear…) only works first in the message; the drift note waits for the next message.
    const drift = text.trimStart().startsWith('/') ? null : model.summary(id)?.drift;
    if (drift) {
      model.setDrift(id, null);
      scheduleSync();
    }
    const schema = !text.trimStart().startsWith('/') && schemaStale.delete(id);
    const notes = [
      ...(drift ? [appContext('Ändringar gjorda utanför appen följde med', describeDrift(drift))] : []),
      ...(schema ? [appContext('Påminnelse om arbetsschemat', SCHEMA_REMINDER)] : []),
    ];
    sendToSession(id, notes.length ? `${notes.join('\n\n')}\n\n${text}` : text);
  }

  /** Judges the agent's answer to "Förbered för komprimering": ready → /compact, otherwise the user decides. */
  async function checkCompact(id: string, answer: string): Promise<void> {
    if (model.summary(id)?.compactCheck?.state !== 'preparing') return;
    let verdict = null;
    try {
      verdict = readCompactCheck(await structuredQuery(compactCheckRequest(answer, userData)));
    } catch {
      // Without a verdict the user decides.
    }
    if (model.summary(id)?.compactCheck?.state !== 'preparing') return;
    if (verdict?.verdict === 'ready') {
      model.setCompactCheck(id, null);
      sendFromUser(id, '/compact');
    } else {
      model.setCompactCheck(id, { state: 'unclear', reason: verdict?.reason || 'Svaret gick inte att bedöma.' });
    }
    scheduleSync();
  }

  function sendToSession(id: string, text: string): void {
    if (engine.isRunning(id)) engine.send(id, text);
    else run(requireRecord(id), text);
  }

  function hasSchema(cwd: string): boolean {
    return existsSync(join(cwd, TODO_RELATIVE_PATH));
  }

  /**
   * Has the session's main agent map its project into the work schema, so the map stays in its own
   * conversation. For that turn it runs on Opus with high effort,
   * then goes back to the card's model and effort. The user's first message waits until the map exists.
   * Mappings run one at a time.
   */
  function startMapping(id: string, guidance: string, firstPrompt?: string): void {
    if (mappingActive?.id === id || mappingQueue.some((j) => j.id === id)) return;
    mappingQueue.push({ id, guidance, firstPrompt });
    model.setMapping(id, true);
    if (mappingActive) onSessionEvent({ type: 'notice', sessionId: id, text: 'Kartläggningen börjar när pågående kartläggning i ett annat projekt är klar.', level: 'info' });
    else scheduleSync();
    void nextMapping();
  }

  /** The running mapping turn of this session, if any. */
  function mappingTurn(id: string): typeof mappingActive {
    return mappingActive?.id === id && mappingActive.restore ? mappingActive : null;
  }

  async function nextMapping(): Promise<void> {
    if (mappingActive) return;
    const job = mappingQueue.shift();
    if (!job) return;
    mappingActive = { ...job, restore: null };
    // A turn in progress is never cut off: the mapping is sent when it is done (see turn_finished).
    const status = model.summary(job.id)?.status;
    if (engine.isRunning(job.id) && (status === 'working' || status === 'waiting')) return;
    await sendMappingTurn();
  }

  async function sendMappingTurn(): Promise<void> {
    const job = mappingActive;
    if (!job || job.restore) return;
    const record = findRecord(job.id);
    if (!record || record.archived) return endMapping('stopped');
    job.restore = { model: record.model, effort: record.effort };
    const planner: ModelChoice = 'opus';
    onSessionEvent({ type: 'notice', sessionId: job.id, text: `Huvudagenten kartlägger projektet på Opus med hög effort och går sedan tillbaka till ${record.model} / ${record.effort}.`, level: 'info' });
    try {
      if (engine.isRunning(job.id)) {
        await engine.setModel(job.id, planner);
        await engine.setEffort(job.id, 'high');
        engine.send(job.id, mappingRequest(job.guidance));
      } else {
        run({ ...record, model: planner, effort: 'high' }, mappingRequest(job.guidance));
        if (!engine.isRunning(job.id)) await endMapping('failed'); // e.g. a terminal still holds the conversation
      }
    } catch (error) {
      onSessionEvent({ type: 'notice', sessionId: job.id, text: `Kartläggningen kunde inte starta: ${error instanceof Error ? error.message : String(error)}`, level: 'warning' });
      await endMapping('failed');
    }
  }

  /** Ends the mapping: back to the card's model and effort, then the held first message, then the next project. */
  async function endMapping(how: 'done' | 'interrupted' | 'stopped' | 'failed'): Promise<void> {
    const job = mappingActive;
    if (!job) return;
    const { id } = job;
    if (job.restore && engine.isRunning(id)) {
      try {
        await engine.setModel(id, job.restore.model);
        await engine.setEffort(id, job.restore.effort);
      } catch {
        // The process ended meanwhile; it starts with the card's saved model and effort next time.
      }
    }
    mappingActive = null;
    model.setMapping(id, false);
    const record = findRecord(id);
    if (how === 'done' && record && !hasSchema(record.cwd)) {
      onSessionEvent({ type: 'notice', sessionId: id, text: 'Agenten skrev inget arbetsschema. Öppna Arbetsschema och kartlägg igen, eller be den i chatten.', level: 'warning' });
    }
    if (job.firstPrompt) {
      if (how === 'done') sendToSession(id, job.firstPrompt);
      else onSessionEvent({ type: 'notice', sessionId: id, text: `Kartläggningen avbröts, så ditt första meddelande skickades inte: ${job.firstPrompt}`, level: 'warning' });
    }
    scheduleSync();
    void nextMapping();
  }

  /**
   * Sessions stopped by the usage limit continue where they were once it has reset: at the reset time
   * the limit gave, or, when it gave none, once the usage readout shows room again.
   */
  function resumeAfterLimit(): void {
    if (!settings.autoResume) return;
    const now = Date.now();
    const current = usage.current();
    const roomAgain = [current.fiveHour, current.sevenDay].every((w) => !w || w.utilization < 100);
    for (const s of model.summaries()) {
      if (s.status !== 'limited' || s.limitResetsAt === null) continue;
      const resets = s.limitResetsAt ? Date.parse(s.limitResetsAt) : NaN;
      if (Number.isFinite(resets) ? now < resets + RESUME_MARGIN_MS : !roomAgain) continue;
      notifier.alert({ sessionId: s.id, title: `${s.name} fortsätter`, body: 'Användningsgränsen har återställts.', urgent: false });
      sendToSession(s.id, appContext('Användningsgränsen har återställts; appen bad agenten fortsätta', RESUME_MESSAGE));
    }
  }

  /** Short versions of the quick chat's long answers (by transcript entry), for the overlay's small panel. */
  const quickSummaries = new Map<string, string>();

  /** Has a cheap model shorten the quick chat's latest answer when it is long; the full answer stays. */
  async function summarizeQuickAnswer(): Promise<void> {
    const transcript = model.transcript(QUICK_ID);
    const answer = [...transcript].reverse().find((e) => e.kind === 'assistant' && e.text.trim());
    const question = [...transcript].reverse().find((e) => e.kind === 'user');
    if (!answer || answer.kind !== 'assistant' || answer.text.length <= SUMMARY_THRESHOLD || quickSummaries.has(answer.id)) return;
    try {
      const summary = readSummary(await structuredQuery(summaryRequest(question?.kind === 'user' ? question.text : '', answer.text, userData)));
      if (!summary) return;
      quickSummaries.set(answer.id, summary);
      pushEvent('state:quick-summaries', Object.fromEntries(quickSummaries));
    } catch {
      // The full answer shows instead.
    }
  }

  /**
   * Has a cheap model tag the main agent's messages of the turn just finished: the questions and choices
   * put to the user (with options and a short background) and what each block of text is (result, passed
   * check, failure, background …), which the transcript styles and folds by. The text is never rewritten.
   * Apart from what the agent tagged itself ([!QUESTION], [!NOTE]), these are the only questions: plain text
   * is never read as questions by rules. The turn's end (its text, questions, status and notification) is
   * held until the tags are in, so it all shows at once; without tags in time it shows as it is.
   */
  async function tagTurn(id: string, result: string): Promise<void> {
    const transcript = model.transcript(id);
    const lastUser = [...transcript].reverse().find((e) => e.kind === 'user');
    const after = lastUser?.id ?? null;
    const from = lastUser ? transcript.indexOf(lastUser) + 1 : 0;
    const all = transcript.slice(from).filter((e): e is Extract<TranscriptEntry, { kind: 'assistant' }> => e.kind === 'assistant' && !e.agentId && !!e.text.trim());
    const messages = messagesForTagging(all.map((e) => e.text));
    const entries = all.slice(-messages.length);
    // The agent's question and note callouts go along last: the tagger keeps real questions and assumptions
    // and drops repeats of questions already open or answered.
    const notes = transcript.slice(from).flatMap((e) => (e.kind === 'callout' && (e.callout.kind === 'note' || e.callout.kind === 'question') ? [`> [!${e.callout.kind.toUpperCase()}] ${e.callout.title ? `**${e.callout.title}:** ` : ''}${e.callout.text}`] : []));
    const toTag = notes.length ? [...messages, splitBlocks(notes.join('\n\n'))] : messages;
    // The same boxes as the user reads them, for a question's background: no markup.
    const plainNotes = transcript.slice(from).flatMap((e) => (e.kind === 'callout' && (e.callout.kind === 'note' || e.callout.kind === 'question') ? [e.callout.title ? `${e.callout.title}: ${e.callout.text}` : e.callout.text] : []));
    const show = (changed: TranscriptEntry[]): void => {
      for (const entry of changed) showEntry(id, entry);
    };
    try {
      if (!entries.length && !notes.length) return;
      const reply = await Promise.race([
        structuredQuery(tagRequest(toTag, userData, workInProgress(model.summary(id)?.todo ?? null), model.askedQuestions(id))),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), TAG_TIMEOUT_MS)),
      ]);
      appLog.write('tags', { sessionId: id, messages: toTag, asked: model.askedQuestions(id), reply });
      const tags = readTags(reply, toTag.map((m) => m.length));
      if (!tags) return;
      tagMemory.remember(id, entries.map((e, i) => ({ text: e.text, tags: tags.tags[i]! })));
      // What the user needs to answer: the blocks the tagger pointed to (pictures, tables, options), else the question's own message.
      const contextOf = (q: (typeof tags.questions)[number]): string => {
        const blocks = q.context.map(([m, b]) => (m <= entries.length ? toTag[m - 1]?.[b - 1] : plainNotes.join('\n\n')) ?? '').filter(Boolean);
        return questionDetail(blocks.length ? blocks : splitBlocks(entries[q.message - 1]?.text ?? plainNotes.join('\n\n')), q.text);
      };
      const questions = tags.questions.map((q) => ({ kind: q.kind, text: q.text, about: q.about, detail: contextOf(q), brief: q.brief, options: q.options }));
      const blocks = entries.map((e, i) => ({ entryId: e.id, blocks: taggedBlocks(messages[i]!, tags.tags[i]!) }));
      show(model.applyTurnTags(id, after, questions, blocks));
    } catch {
      // Without tags the turn shows as it is, with only the questions the agent tagged itself.
    } finally {
      show(model.endTagging(id, after));
      announceTurnEnd(id, result);
      scheduleSync();
    }
  }

  /** Tells the user a turn has ended: urgently when it left questions, otherwise only if they asked to hear. */
  function announceTurnEnd(id: string, result: string): void {
    const s = model.summary(id);
    if (!s || s.status === 'working' || s.pendingCount) return;
    if (s.status === 'waiting' && s.questions.length) {
      notifier.alert({ sessionId: id, title: `${s.name} har ${s.questions.length} frågor till dig`, body: s.questions.slice(0, 3).map((q) => q.text).join('\n'), urgent: true });
    } else if (settings.alertOnDone) {
      notifier.alert({ sessionId: id, title: `${s.name} är klar`, body: result, urgent: false });
    }
  }


  /**
   * The usage readout at 100 % means requests are refused, also for subagents whose refusal never reaches
   * the main turn. Sessions that were working at that moment (a turn or subagents running) are marked as
   * stopped by the limit, so they continue once it resets; idle sessions are left alone.
   */
  function markLimitedFromUsage(snapshot: UsageSnapshot): void {
    const full = [snapshot.fiveHour, snapshot.sevenDay].filter((w): w is UsageWindow => !!w && w.utilization >= 100);
    if (!full.length) return;
    const resetsAt = full.map((w) => w.resetsAt ?? '').sort().pop() ?? '';
    for (const s of model.summaries()) {
      if (s.limitResetsAt !== null || (s.status !== 'working' && !s.activeAgents)) continue;
      model.setLimit(s.id, resetsAt);
      rememberLimit(s.id);
    }
    scheduleSync();
  }

  /** Saves the usage-limit mark with the card when it changes, so it survives a restart. */
  /** Saves each card's open questions when they change, so they survive a restart (an update installs by restarting). */
  function rememberQuestions(summaries: SessionSummary[]): void {
    saveRecords(
      summaries.flatMap((s) => {
        const record = findRecord(s.id);
        if (!record || (record.openQuestions?.id ?? '') === (s.questions.length ? s.questionsId : '')) return [];
        const { openQuestions: _old, ...rest } = record;
        return [s.questions.length ? { ...rest, openQuestions: { id: s.questionsId, answer: s.questionsAnswer, questions: s.questions } } : rest];
      }),
    );
  }

  function rememberLimit(id: string): void {
    const record = findRecord(id);
    const limit = model.summary(id)?.limitResetsAt ?? null;
    if (record && record.limitResetsAt !== limit) saveRecord({ ...record, limitResetsAt: limit });
  }

  /** Moves a session into Fokus (others leave when there are too many). */
  function focus(id: string): void {
    saveRecords(bringIntoFocus(records, id));
  }

  function requireRecord(id: string): SessionRecord {
    const record = findRecord(id);
    if (!record) throw new Error(`Okänd session: ${id}`);
    return record;
  }

  function composeAppend(): string {
    return [groundRules.read().trim(), TODO_PROTOCOL, CALLOUT_PROTOCOL, SCHEDULE_PROTOCOL, usageNote(usageFile)].join('\n\n');
  }

  /** The plan's usage as agents read it: percent used of each limit and when it resets. */
  function saveUsageForAgents(snapshot: UsageSnapshot): void {
    if (!snapshot.updatedAt) return;
    const window = (w: UsageWindow | null): { percentUsed: number; resetsAt: string | null } | null => (w ? { percentUsed: Math.round(w.utilization), resetsAt: w.resetsAt } : null);
    try {
      writeFileSync(usageFile, JSON.stringify({ updatedAt: new Date(snapshot.updatedAt).toISOString(), fiveHour: window(snapshot.fiveHour), week: window(snapshot.sevenDay) }, null, 2));
    } catch {
      // Agents read the last saved figures.
    }
  }

  /** The tags saved for the card's messages, for those whose text still splits into as many blocks. */
  function savedBlocks(id: string): Array<{ entryId: string; blocks: TaggedBlock[] }> {
    return model.transcript(id).flatMap((e) => {
      if (e.kind !== 'assistant' || e.agentId || e.blocks || !e.text.trim()) return [];
      const tags = tagMemory.recall(id, e.text);
      const blocks = tags && splitBlocks(e.text);
      return blocks && blocks.length === tags.length ? [{ entryId: e.id, blocks: taggedBlocks(blocks, tags) }] : [];
    });
  }

  /**
   * Gives a work schema's long titles short labels for the tree: from the cache, and for new ones from a
   * cheap model (one call per change, only the titles not seen before).
   */
  async function labelSchema(id: string, tree: TodoTree): Promise<void> {
    const nodes: Array<{ id: string; title: string }> = [{ id: 'root', title: tree.title }];
    const walk = (n: TodoNode): void => {
      nodes.push({ id: n.id, title: n.title });
      n.children.forEach(walk);
    };
    tree.tracks.forEach(walk);
    const long = nodes.filter((n) => n.title && needsLabel(n.title));
    const apply = (): void => {
      model.setTodoLabels(id, Object.fromEntries(long.flatMap((n) => (labelCache[n.title] ? [[n.id, labelCache[n.title]!]] : []))));
      scheduleSync();
    };
    apply();
    const missing = [...new Set(long.map((n) => n.title).filter((t) => !labelCache[t]))];
    if (!missing.length || labelling.has(id)) return;
    labelling.add(id);
    try {
      const labels = readLabels(await structuredQuery(labelRequest(missing, userData)), missing.length);
      labelCache = { ...labelCache, ...Object.fromEntries(missing.flatMap((t, i) => (labels[i] ? [[t, labels[i]!]] : []))) };
      labelStore.write(labelCache);
      apply();
    } catch {
      // The full titles show until the next schema change tries again.
    } finally {
      labelling.delete(id);
    }
  }

  /** Gives a card without an icon one that suits its project, once it has a work schema to go by. */
  async function pickIcon(id: string, tree: TodoTree): Promise<void> {
    const record = findRecord(id);
    if (!record || record.icon || record.kind === 'quick' || pickingIcon.has(id)) return;
    pickingIcon.add(id);
    try {
      const titles = [tree.title, ...tree.tracks.flatMap((t) => [`${t.id} ${t.title}`, ...t.children.map((c) => `${c.id} ${c.title}`)])].filter(Boolean);
      const icon = readIcon(await structuredQuery(iconRequest(record.name, titles, userData)));
      const latest = findRecord(id);
      if (icon && latest && !latest.icon) {
        saveRecord({ ...latest, icon });
        scheduleSync();
      }
    } catch {
      // Initials show until the next schema change tries again.
    } finally {
      pickingIcon.delete(id);
    }
  }

  function jobKey(sessionId: string, jobId: string): string {
    return `${sessionId}:${jobId}`;
  }

  /** Shows each project's jobs with their rhythm, next run and last run. */
  function refreshSchedules(): void {
    let changed = false;
    for (const record of activeRecords()) {
      const { jobs, problem } = readJobs(record.cwd);
      const views = jobs.map((job) => ({
        ...job,
        rhythm: describeCron(job.cron),
        nextRun: job.enabled ? (nextRunOf(job.cron, new Date())?.toISOString() ?? null) : null,
        lastRun: jobRuns[jobKey(record.id, job.id)] ?? null,
      }));
      const before = model.summary(record.id);
      if (JSON.stringify(before?.schedule) !== JSON.stringify(views) || before?.scheduleProblem !== problem) {
        model.setSchedule(record.id, views, problem);
        changed = true;
      }
    }
    if (changed) scheduleSync();
  }

  /**
   * A job is due: a command runs here in the project folder (no agent, no tokens) and, if it fails and
   * asks for it, tells the agent; a task goes to the project's agent as a message from the app.
   */
  async function runJob(sessionId: string, cwd: string, job: ScheduledJob): Promise<void> {
    if (job.kind === 'agent') {
      jobRuns = { ...jobRuns, [jobKey(sessionId, job.id)]: { at: new Date().toISOString(), ok: true, output: '', durationMs: 0 } };
      jobRunsStore.write(jobRuns);
      sendToSession(sessionId, appContext(`Schemalagt jobb: ${job.name}`, `Schemalagt jobb "${job.name}" (${describeCron(job.cron)}):\n\n${job.prompt}`));
    } else {
      const run = await runCommand(cwd, job.command);
      jobRuns = { ...jobRuns, [jobKey(sessionId, job.id)]: run };
      jobRunsStore.write(jobRuns);
      if (!run.ok && job.wakeAgentOnFailure) {
        sendToSession(sessionId, appContext(`Schemalagt jobb misslyckades: ${job.name}`, `Det schemalagda kommandot "${job.name}" misslyckades.\n\nKommando: ${job.command}\n\nUtdata (slutet):\n${run.output || '(ingen)'}\n\nUndersök felet och rätta det om du kan; säg kort vad som hände.`));
      }
    }
    refreshSchedules();
  }

  /** Notes the project's git state as the app leaves it after a turn, so later changes made elsewhere stand out. */
  async function stampMark(id: string): Promise<void> {
    const record = findRecord(id);
    if (!record || record.kind === 'quick') return;
    const mark = await markOf(record.cwd);
    const latest = findRecord(id);
    if (!mark || !latest || (latest.mark?.head === mark.head && latest.mark.changes === mark.changes)) return;
    saveRecord({ ...latest, mark });
  }

  /**
   * Looks for work done on each project outside the app since its mark (sessions busy right now are left
   * alone: their own changes are not drift). A card without a mark gets one now.
   */
  async function checkDrift(): Promise<void> {
    for (const record of activeRecords()) {
      const s = model.summary(record.id);
      if (!s || record.kind === 'quick' || s.status === 'working' || s.activeAgents || s.mapping) continue;
      // A card from before marks existed starts from the project as it stood when its schema was last updated.
      const known = record.mark ?? (s.todo?.updated ? await markAt(record.cwd, s.todo.updated) : null);
      if (!known) {
        await stampMark(record.id);
        continue;
      }
      const drift = await driftSince(record.cwd, known);
      if (!drift && !record.mark) await stampMark(record.id);
      if (drift && JSON.stringify(drift.mark) !== JSON.stringify(s.drift?.mark)) {
        model.setDrift(record.id, drift);
        scheduleSync();
      }
    }
  }

  /** The work schema's items in progress ("cad.2.1 Kåpan"), so the tagger can tie a question to its step. */
  function workInProgress(tree: TodoTree | null): string[] {
    const leaves = (n: TodoNode): TodoNode[] => (n.children.length ? n.children.flatMap(leaves) : n.status === 'in_progress' ? [n] : []);
    return (tree?.tracks ?? []).flatMap(leaves).slice(0, 12).map((n) => `${n.id} ${n.title}`);
  }

  /** Puts a saved conversation in front of the card's transcript (no tokens; local files). */
  function loadSavedHistory(record: SessionRecord): void {
    if (!record.claudeSessionId) return;
    loadHistory(record.id, record.claudeSessionId, record.cwd)
      .then((events) => {
        model.loadHistory(record.id, events);
        model.setBlocks(record.id, savedBlocks(record.id));
        pushEvent('session:transcript-reset', { id: record.id, entries: model.transcript(record.id) });
      })
      .catch(() => undefined); // No saved transcript (deleted or never written): the card simply starts empty.
  }

  function run(record: SessionRecord, prompt: string | undefined): void {
    // Two processes writing one conversation would corrupt it, so a terminal that still holds it wins.
    const holder = record.claudeSessionId ? liveTerminals(claudeDir).find((t) => t.sessionId === record.claudeSessionId) : undefined;
    if (holder) {
      const message = `Körs fortfarande i ett terminalfönster (${holder.name || `pid ${holder.pid}`}). Stäng fönstret när agenten är klar med sin tur, sedan fortsätter du här med hela samtalet.`;
      onSessionEvent({ type: 'error', sessionId: record.id, message });
      return;
    }
    engine.start({
      id: record.id,
      cwd: record.cwd,
      model: record.model,
      effort: record.effort,
      contextWindow: record.contextWindow,
      permissionMode: record.permissionMode,
      appendSystemPrompt: composeAppend(),
      subagentBrief: SUBAGENT_SCHEMA_BRIEF,
      resumeClaudeSessionId: record.claudeSessionId,
      initialPrompt: prompt,
    });
  }

  function createSession(kind: SessionKind, name: string, cwd: string, options: NewSessionOptions, id = randomUUID()): string {
    const record: SessionRecord = {
      id,
      name,
      color: pickColor(activeRecords().map((r) => r.color)),
      kind,
      cwd,
      model: options.model,
      effort: options.effort,
      permissionMode: options.permissionMode,
      createdAt: new Date().toISOString(),
      archived: false,
      focused: false,
      lastActiveAt: new Date().toISOString(),
      contextWindow: 'auto',
      tokensUsed: 0,
      limitResetsAt: null,
    };
    saveRecord(record);
    focus(id);
    todo.watch(id, cwd);
    run(record, options.prompt?.trim() || undefined);
    return id;
  }

  /**
   * A card that continues a saved Claude Code conversation: its history is shown at once, and the
   * session resumes on the first message (right away when `options.prompt` is given).
   */
  function continueSession(candidate: ImportCandidate, options: NewSessionOptions, name: string): string {
    const record: SessionRecord = {
      id: randomUUID(),
      name,
      color: pickColor(activeRecords().map((r) => r.color)),
      kind: 'project',
      cwd: candidate.cwd,
      model: options.model,
      effort: options.effort,
      permissionMode: options.permissionMode,
      claudeSessionId: candidate.claudeSessionId,
      createdAt: new Date().toISOString(),
      archived: false,
      focused: false,
      lastActiveAt: new Date(candidate.lastActivity).toISOString(),
      contextWindow: 'auto',
      tokensUsed: 0,
      limitResetsAt: null,
    };
    saveRecord(record);
    todo.watch(record.id, record.cwd);
    loadSavedHistory(record);
    const prompt = options.prompt?.trim();
    if (prompt) run(record, prompt);
    return record.id;
  }

  /** The folder name, plus the conversation title when the folder already has a card, so cards stay apart. */
  function cardName(cwd: string, title: string): string {
    const folder = basename(cwd);
    return activeRecords().some((r) => sameFolder(r.cwd, cwd)) && title ? `${folder} · ${title}` : folder;
  }

  function showSession(id: string): void {
    focus(id);
    windows.showMain();
    pushEvent('ui:open-session', { id });
  }

  // ---------- Settings ----------
  function updateSettings(changes: Partial<AppSettings>): AppSettings {
    settings = validSettings({ ...settings, ...changes }) ?? settings;
    settingsStore.write(settings);
    notifier.setDoNotDisturb(settings.doNotDisturb);
    applyLaunchAtLogin();
    tray.setLaunchAtLogin(settings.launchAtLogin);
    windows.setTheme(settings.theme);
    keepAwake.set(settings.keepAwake);
    appLog.setEnabled(settings.logging);
    if (changes.autoUpdate !== undefined) updater?.setAuto(settings.autoUpdate);
    pushEvent('state:settings', settings);
    scheduleSync();
    return settings;
  }

  /** What the app tells its windows. */
  function pushEvent<K extends IpcEventChannel>(channel: K, payload: IpcEventMap[K]): void {
    windows.send(channel, payload);
  }

  /** Registers (or removes) the app as a Windows login item. Only the installed app: a dev run would register electron.exe. */
  function applyLaunchAtLogin(): void {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: [AUTOSTART_ARG] });
  }

  // ---------- Lifecycle ----------
  function confirmClose(event: Electron.Event): void {
    if (!model.summaries().some((s) => !s.resumable)) {
      quit();
      return;
    }
    event.preventDefault();
    void dialog
      .showMessageBox({
        type: 'question',
        title: 'Claude Manager',
        message: 'Sessioner körs fortfarande.',
        detail: 'Minimera till systemfältet så fortsätter de att köra, eller stoppa alla och avsluta.',
        buttons: ['Minimera till systemfältet', 'Stoppa alla och avsluta', 'Avbryt'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) windows.hideMain();
        if (response === 1) quit();
      });
  }

  function quit(): void {
    if (quitting) return;
    quitting = true;
    clearInterval(focusTimer);
    clearInterval(resumeTimer);
    updater?.stop();
    engine.stopAll();
    usage.stop();
    todo.close();
    tray.destroy();
    windows.allowMainClose();
    windows.destroyAll();
    app.quit();
  }

  // ---------- IPC ----------
  function handle<K extends IpcInvokeChannel>(
    channel: K,
    fn: (req: IpcInvokeMap[K]['req']) => IpcInvokeMap[K]['res'] | Promise<IpcInvokeMap[K]['res']>,
  ): void {
    ipcMain.handle(channel, (_event, req: IpcInvokeMap[K]['req']) => {
      // What the user does in the app (the constant hover and state reads are left out).
      if (!QUIET_CHANNELS.has(channel)) appLog.write('ui', { channel, req });
      return fn(req);
    });
  }

  handle('app:get-state', () => ({ sessions: model.summaries(), usage: usage.current(), settings, account, update: updateStatus() }));
  handle('update:install', () => updater?.installNow());
  handle('log:open-folder', async () => {
    await shell.openPath(appLog.dir);
  });
  handle('update:check', () => updater?.checkNow());

  handle('quick:ask', (req) => {
    const text = req.text.trim();
    if (!text) return;
    if (engine.isRunning(QUICK_ID)) return engine.send(QUICK_ID, text);
    const cwd = join(userData, 'quick');
    mkdirSync(cwd, { recursive: true });
    const now = new Date().toISOString();
    model.upsertRecord({
      id: QUICK_ID, name: 'Snabbfråga', color: '#6a76b8', kind: 'quick', cwd, model: 'sonnet', effort: 'low', permissionMode: 'auto',
      createdAt: now, archived: false, focused: false, lastActiveAt: now, contextWindow: 'auto', tokensUsed: 0, limitResetsAt: null,
    });
    engine.start({ id: QUICK_ID, cwd, model: 'sonnet', effort: 'low', permissionMode: 'auto', contextWindow: 'auto', appendSystemPrompt: QUICK_PROMPT, initialPrompt: text });
  });

  handle('quick:new', async () => {
    // The next question starts a fresh session; the transcript so far stays.
    await engine.stop(QUICK_ID);
  });

  handle('quick:reset', async () => {
    quickSummaries.clear();
    pushEvent('state:quick-summaries', {});
    await engine.stop(QUICK_ID);
    model.remove(QUICK_ID);
    pushEvent('session:transcript-reset', { id: QUICK_ID, entries: [] });
    scheduleSync();
  });

  handle('quick:current', () => model.summary(QUICK_ID) ?? null);

  handle('shell:open', async (req) => {
    const target = req.target.trim();
    if (/^(https?:|mailto:)/i.test(target)) return shell.openExternal(target);
    const path = localPath(target);
    if (!path || !existsSync(path)) throw new Error(`Hittar inte ${path ?? target}`);
    // A program or script an agent links to is shown in its folder, never started by a click.
    if (RUNNABLE.test(path)) return shell.showItemInFolder(path);
    const failed = await shell.openPath(path);
    if (failed) throw new Error(failed);
  });
  handle('file:act', async (req) => {
    const path = localPath(req.target.trim().replace(/^<|>$/g, ''));
    if (!path || !existsSync(path)) throw new Error(`Hittar inte ${path ?? req.target}`);
    if (req.action === 'show') return shell.showItemInFolder(path);
    if (req.action === 'copy') return copyToClipboard(path);
    if (!statSync(path).isFile()) throw new Error('Det är en mapp, inte en fil.');
    if (req.action === 'save-as') return saveCopyAs(path, BrowserWindow.getFocusedWindow());
    return mailWithAttachment(path);
  });
  handle('file:outlook', async () => (await outlookPath()) !== null);
  handle('quick:summaries', () => Object.fromEntries(quickSummaries));

  handle('session:new-project', (req) => {
    const cwd = projects.create(req.name);
    const name = basename(cwd);
    const prompt = req.createGitRepo ? [gitSetupPrompt(name), req.prompt?.trim()].filter(Boolean).join('\n\nAfter that: ') : req.prompt;
    return createSession('project', name, cwd, { ...req, prompt });
  });

  handle('session:locate-project', async (req) => {
    const candidates = projects.list();
    const found = await locateProject(projectsRoot(), req.description, candidates, structuredQuery);
    return { ...found, candidates };
  });

  const knownSessionIds = (): Set<string> => new Set(records.flatMap((r) => (r.claudeSessionId && !r.archived ? [r.claudeSessionId] : [])));

  handle('session:import-candidates', () => importCandidates(claudeDir, knownSessionIds()));

  handle('session:import', async (req) => {
    const wanted = new Set(req.claudeSessionIds);
    const chosen = (await importCandidates(claudeDir, knownSessionIds())).filter((c) => wanted.has(c.claudeSessionId));
    const defaults: NewSessionOptions = { model: settings.defaultModel, effort: settings.defaultEffort, permissionMode: settings.defaultPermissionMode };
    for (const candidate of chosen) {
      const id = continueSession(candidate, defaults, cardName(candidate.cwd, candidate.title));
      if (!hasSchema(candidate.cwd)) startMapping(id, '');
    }
  });

  handle('session:folder-sessions', async (req) => ({
    candidates: await importCandidates(claudeDir, knownSessionIds(), { dir: req.cwd }),
    existingCardId: activeRecords().find((r) => sameFolder(r.cwd, req.cwd))?.id ?? null,
  }));

  handle('session:open-project', async (req) => {
    if (!existsSync(req.cwd) || !statSync(req.cwd).isDirectory()) throw new Error(`Mappen finns inte: ${req.cwd}`);
    // A project without a work schema is mapped first; the first message waits until the map exists.
    const mapFirst = !hasSchema(req.cwd);
    const options = mapFirst ? { ...req, prompt: undefined } : req;
    let id: string;
    if (!req.claudeSessionId) {
      id = createSession('project', req.name?.trim() || cardName(req.cwd, 'nytt samtal'), req.cwd, options);
    } else {
      const candidate = (await importCandidates(claudeDir, knownSessionIds(), { dir: req.cwd })).find((c) => c.claudeSessionId === req.claudeSessionId);
      if (!candidate) throw new Error('Samtalet finns inte längre (eller har redan ett kort).');
      id = continueSession(candidate, options, req.name?.trim() || cardName(candidate.cwd, candidate.title));
      focus(id);
    }
    if (mapFirst) startMapping(id, '', req.prompt?.trim() || undefined);
    return id;
  });

  handle('session:map-project', (req) => startMapping(req.id, req.guidance));

  handle('session:send', (req) => {
    model.setCompactCheck(req.id, null);
    sendFromUser(req.id, req.text);
  });

  handle('session:compact', (req) => {
    const s = model.summary(req.id);
    if (!s) return;
    if (req.action === 'prepare') {
      if (s.status === 'working' || s.compacting || s.compactCheck) return;
      sendFromUser(req.id, `Förbered för komprimering

${appContext('Appen komprimerar samtalet när du är redo', 'Spara det som måste överleva komprimeringen (till arbetsschemat eller anteckningar) och svara sedan kort, en eller två meningar, om du är redo.')}`);
      model.setCompactCheck(req.id, { state: 'preparing', reason: '' });
    } else {
      model.setCompactCheck(req.id, null);
      if (req.action === 'now') sendFromUser(req.id, '/compact');
    }
    scheduleSync();
  });

  // Pasted images older than a month go, so the temp folder does not grow for ever (chats older than that show them as missing).
  pruneOld(join(tmpdir(), 'claude-manager-paste'), PASTE_KEEP_MS);

  handle('session:paste-image', (req) => {
    const ext = PASTE_TYPES[req.mime];
    if (!ext) throw new Error('Bara PNG, JPEG, GIF och WebP kan klistras in.');
    const bytes = Buffer.from(req.data, 'base64');
    if (bytes.length > PASTE_MAX_BYTES) throw new Error('Bilden är större än 5 MB.');
    const dir = join(tmpdir(), 'claude-manager-paste', req.id);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `paste-${Date.now()}-${randomUUID().slice(0, 6)}.${ext}`);
    writeFileSync(path, bytes);
    return path.split('\\').join('/');
  });

  handle('session:paste-file', (req) => {
    const bytes = Buffer.from(req.data, 'base64');
    if (bytes.length > PASTE_FILE_MAX_BYTES) throw new Error('Filen är större än 10 MB.');
    const name = basename(req.name.split('\\').join('/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'fil';
    const dir = join(tmpdir(), 'claude-manager-paste', req.id);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${Date.now()}-${name}`);
    writeFileSync(path, bytes);
    return path.split('\\').join('/');
  });

  handle('session:redirect', async (req) => {
    // The running turn stops; the message waiting (or this one) is what the agent takes up next.
    if (engine.isRunning(req.id) && model.summary(req.id)?.status === 'working') await engine.interrupt(req.id);
    if (req.text?.trim()) sendFromUser(req.id, req.text);
  });

  handle('schedule:act', async (req) => {
    const record = requireRecord(req.id);
    const { jobs } = readJobs(record.cwd);
    const job = jobs.find((j) => j.id === req.jobId);
    if (!job) return;
    if (req.action === 'run') await runJob(record.id, record.cwd, job);
    else if (req.action === 'delete') writeJobs(record.cwd, jobs.filter((j) => j.id !== job.id));
    else writeJobs(record.cwd, jobs.map((j) => (j.id === job.id ? { ...j, enabled: req.action === 'resume' } : j)));
    refreshSchedules();
  });

  handle('session:drift', (req) => {
    const drift = model.summary(req.id)?.drift;
    if (!drift) return;
    model.setDrift(req.id, null);
    if (req.action === 'update') sendToSession(req.id, appContext('Appen bad agenten uppdatera arbetsschemat efter ändringar utanför appen', `${describeDrift(drift)}\n\n${DRIFT_UPDATE_PROMPT}`));
    else if (req.action === 'remap') startMapping(req.id, '');
    else saveRecord({ ...requireRecord(req.id), mark: drift.mark });
    scheduleSync();
  });

  handle('session:answer', (req) => engine.answerQuestion(req.id, req.requestId, req.answers));
  handle('session:permission', (req) => engine.resolvePermission(req.id, req.requestId, req.decision));
  handle('session:interrupt', (req) => {
    model.setCompactCheck(req.id, null);
    return engine.interrupt(req.id);
  });
  handle('session:transcript', (req) => model.transcript(req.id));

  handle('session:set-model', async (req) => {
    // During a mapping turn the choice is saved and applies once the mapping is done.
    const mapping = mappingTurn(req.id);
    if (mapping?.restore) mapping.restore.model = req.model;
    if (engine.isRunning(req.id) && !mapping) await engine.setModel(req.id, req.model);
    else saveRecord({ ...requireRecord(req.id), model: req.model });
  });

  handle('session:set-context-window', async (req) => {
    saveRecord({ ...requireRecord(req.id), contextWindow: req.window });
    onSessionEvent({ type: 'context_window_changed', sessionId: req.id, window: req.window });
    if (!engine.isRunning(req.id)) return;
    // Claude Code reads the window only at start, so a running session restarts with the same conversation.
    // A turn in progress is never cut off: the restart then waits until the turn is done.
    const status = model.summary(req.id)?.status;
    if (status === 'working' || status === 'waiting') awaitingRestart.add(req.id);
    else await restart(req.id);
  });

  handle('session:set-effort', async (req) => {
    const mapping = mappingTurn(req.id);
    if (mapping?.restore) mapping.restore.effort = req.effort;
    if (engine.isRunning(req.id) && !mapping) await engine.setEffort(req.id, req.effort);
    else saveRecord({ ...requireRecord(req.id), effort: req.effort });
  });

  handle('session:resume', (req) => {
    if (!engine.isRunning(req.id)) run(requireRecord(req.id), undefined);
  });

  handle('session:delete', (req) => {
    void engine.stop(req.id);
    todo.unwatch(req.id);
    notifier.clear(req.id);
    tagMemory.forget(req.id);
    model.remove(req.id);
    records = records.filter((r) => r.id !== req.id);
    recordStore.write(records);
    scheduleSync();
  });

  handle('session:rename', (req) => {
    const name = req.name.trim();
    if (name) saveRecord({ ...requireRecord(req.id), name });
  });

  handle('session:set-focus', (req) => {
    if (req.focused) focus(req.id);
    else saveRecord({ ...requireRecord(req.id), focused: false });
  });

  handle('session:mark-seen', (req) => {
    model.markSeen(req.id);
    scheduleSync();
  });

  handle('session:dismiss-callouts', (req) => {
    model.dismissCallouts(req.id);
    if (!model.summary(req.id)?.pendingCount) notifier.clear(req.id);
    scheduleSync();
  });

  handle('ground-rules:edit', (req) => {
    groundRules.ensure();
    const options: NewSessionOptions = {
      model: settings.defaultModel,
      effort: settings.defaultEffort,
      permissionMode: 'acceptEdits',
      prompt: groundRulesEditorPrompt(groundRules.path, req.instructions),
    };
    return createSession('ground-rules', 'Grundregler', userData, options);
  });

  handle('settings:update', (req) => updateSettings(req));

  handle('settings:choose-projects-root', async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Välj mappen där dina projekt ligger',
      defaultPath: projectsRoot(),
      properties: ['openDirectory', 'createDirectory'],
    });
    const folder = picked.canceled ? undefined : picked.filePaths[0];
    return folder ? updateSettings({ projectsRoot: folder }) : null;
  });

  handle('usage:refresh', () => usage.refreshNow());
  handle('usage:day', () => todayOf(dayUsage, localDate(new Date())));
  handle('window:snap', (req) => windows.snap(req.mode));
  handle('window:ensure-width', (req) => windows.ensureWidth(req.width));
  handle('window:show-session', (req) => showSession(req.id));
  handle('overlay:set-interactive', (req) => windows.setOverlayInteractive(req.interactive));
  handle('overlay:set-detail', (req) => windows.setOverlayDetail(req.open, req.wide));
  handle('overlay:set-focus', (req) => windows.setOverlayFocus(req.focus));
  handle('overlay:drag', (req) => windows.dragOverlay(req.phase));
  handle('popup:open', (req) => windows.openPopup(req));
  handle('popup:close', () => windows.closePopup());
  handle('popup:current', () => windows.popupView());

}

// ---------- Pure helpers ----------

/** In the installed app the SDK's Claude binary sits outside the asar archive; in development the SDK finds it itself. */
/** Files a click must not start. */
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|lnk|hta|cpl|reg|jar)$/i;

/** A local path from a link target: a file: URL, a Windows path, possibly percent-encoded. Null otherwise. */
function localPath(target: string): string | null {
  try {
    const path = /^file:/i.test(target) ? fileURLToPath(target) : decodeURIComponent(target);
    return /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(path) ? path : null;
  } catch {
    return null;
  }
}

function sameFolder(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

function packagedClaudeBinary(): string | undefined {
  if (!app.isPackaged) return undefined;
  return join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe');
}

/** Text size between 80 % and 160 %, in steps of 5 %. */
function clampScale(value: number): number {
  return Math.round(Math.min(1.6, Math.max(0.8, value)) * 20) / 20;
}

function gitSetupPrompt(name: string): string {
  return [
    'First task: initialise a local Git repository in this folder (branch main) and create a matching private repository',
    `on the user's GitHub with \`gh repo create ${name} --private --source . --remote origin\`.`,
    'Push once there is a first commit.',
  ].join(' ');
}

function validSettings(r: unknown): AppSettings | null {
  if (!isRecord(r)) return null;
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  const d = DEFAULT_SETTINGS;
  return {
    projectsRoot: typeof r['projectsRoot'] === 'string' ? r['projectsRoot'] : d.projectsRoot,
    doNotDisturb: bool(r['doNotDisturb'], d.doNotDisturb),
    alertOnDone: bool(r['alertOnDone'], d.alertOnDone),
    dockVisible: bool(r['dockVisible'], d.dockVisible),
    dockEdge: pick(r['dockEdge'], DOCK_EDGES, d.dockEdge),
    overlayVisible: bool(r['overlayVisible'], d.overlayVisible),
    overlayAnchor: isRecord(r['overlayAnchor']) && typeof r['overlayAnchor']['centerX'] === 'number' && typeof r['overlayAnchor']['top'] === 'number' ? { centerX: r['overlayAnchor']['centerX'], top: r['overlayAnchor']['top'] } : null,
    launchAtLogin: bool(r['launchAtLogin'], d.launchAtLogin),
    autoUpdate: bool(r['autoUpdate'], d.autoUpdate),
    autoResume: bool(r['autoResume'], d.autoResume),
    logging: bool(r['logging'], d.logging),
    keepAwake: bool(r['keepAwake'], d.keepAwake),
    theme: pick(r['theme'], THEME_CHOICES, d.theme),
    textScale: typeof r['textScale'] === 'number' && Number.isFinite(r['textScale']) ? clampScale(r['textScale']) : d.textScale,
    defaultModel: pick(r['defaultModel'], MODEL_CHOICES, d.defaultModel),
    defaultEffort: pick(r['defaultEffort'], EFFORT_CHOICES, d.defaultEffort),
    defaultPermissionMode: pick(r['defaultPermissionMode'], PERMISSION_CHOICES, d.defaultPermissionMode),
  };
}

/** Keeps well-formed records and fills in fields that older records lack. */
function validSavedQuestions(raw: unknown): SavedQuestions | null {
  if (!isRecord(raw) || typeof raw['id'] !== 'string' || typeof raw['answer'] !== 'string' || !Array.isArray(raw['questions'])) return null;
  const questions = raw['questions'].flatMap((q): OpenQuestion[] =>
    isRecord(q) && typeof q['text'] === 'string'
      ? [{
          kind: q['kind'] === 'assumption' ? 'assumption' : 'question',
          text: q['text'],
          about: typeof q['about'] === 'string' ? q['about'] : '',
          detail: typeof q['detail'] === 'string' ? q['detail'] : '',
          brief: typeof q['brief'] === 'string' ? q['brief'] : '',
          options: Array.isArray(q['options']) ? q['options'].filter((o): o is string => typeof o === 'string') : [],
        }]
      : [],
  );
  return questions.length ? { id: raw['id'], answer: raw['answer'], questions } : null;
}

function validRecords(raw: unknown): SessionRecord[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((r): SessionRecord[] => {
    const valid =
      isRecord(r) &&
      ['id', 'name', 'color', 'kind', 'cwd', 'model', 'permissionMode', 'createdAt'].every((k) => typeof r[k] === 'string') &&
      typeof r['archived'] === 'boolean';
    if (!valid) return [];
    const effort = EFFORT_CHOICES.find((e) => e === r['effort']) ?? 'default';
    // Records saved before these fields existed: default effort, not in Fokus, last active when created.
    const focused = r['focused'] === true;
    const lastActiveAt = typeof r['lastActiveAt'] === 'string' ? r['lastActiveAt'] : String(r['createdAt']);
    const contextWindow = CONTEXT_WINDOW_CHOICES.find((w) => w === r['contextWindow']) ?? 'auto';
    const tokensUsed = typeof r['tokensUsed'] === 'number' ? r['tokensUsed'] : 0;
    const limitResetsAt = typeof r['limitResetsAt'] === 'string' ? r['limitResetsAt'] : null;
    // Sessions saved with the earlier bright colours get their muted counterparts.
    const color = currentColor(String(r['color']));
    const icon = SESSION_ICONS.find((i) => i === r['icon']);
    const record: SessionRecord = { ...(r as unknown as SessionRecord), color, effort, focused, lastActiveAt, contextWindow, tokensUsed, limitResetsAt };
    if (icon) record.icon = icon;
    else delete record.icon;
    const mark = isRecord(r['mark']) && typeof r['mark']['head'] === 'string' && typeof r['mark']['changes'] === 'string' ? { head: r['mark']['head'], changes: r['mark']['changes'] } : null;
    if (mark) record.mark = mark;
    else delete record.mark;
    const saved = validSavedQuestions(r['openQuestions']);
    if (saved) record.openQuestions = saved;
    else delete record.openQuestions;
    return [record];
  });
}

/** Removes files under `dir` not changed for `maxAgeMs`, and folders left empty. Errors are ignored. */
function pruneOld(dir: string, maxAgeMs: number): void {
  const cutoff = Date.now() - maxAgeMs;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        pruneOld(path, maxAgeMs);
        if (!readdirSync(path).length) rmSync(path, { recursive: true });
      } else if (statSync(path).mtimeMs < cutoff) rmSync(path);
    } catch {
      // In use or gone: try again next start.
    }
  }
}
