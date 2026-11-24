// Composition root: the only place that knows every module. It wires modules together with
// callbacks and data, owns persistence of records/settings, and serves the renderer's IPC.
import { app, dialog, ipcMain, nativeImage, shell } from 'electron';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import iconPath from '../../resources/icon.png?asset';
import { CONTEXT_WINDOW_CHOICES, DOCK_EDGES, EFFORT_CHOICES, MODEL_CHOICES, PERMISSION_CHOICES, THEME_CHOICES } from '../shared/contracts';
import { isRecord } from '../shared/guards';
import type {
  AppSettings,
  TranscriptEntry,
  UsageSnapshot,
  UsageWindow,
  UpdateStatus,
  EffortChoice,
  ImportCandidate,
  ModelChoice,
  IpcInvokeChannel,
  IpcInvokeMap,
  NewSessionOptions,
  SessionEvent,
  SessionKind,
  SessionRecord,
  TaggedBlock,
  TodoNode,
  TodoTree,
} from '../shared/contracts';
import { CALLOUT_PROTOCOL, createSessionEngine, loadHistory } from './modules/session-engine';
import { createSessionModel } from './modules/session-model';
import { createUsageMonitor } from './modules/usage-monitor';
import { createTodoWatcher, mappingRequest, TODO_PROTOCOL, TODO_RELATIVE_PATH } from './modules/todo-tree';
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
import { messagesForTagging, readTags, splitBlocks, tagRequest, taggedBlocks } from './modules/turn-tags';
import { createTagMemory } from './modules/tag-memory';
import { readSummary, SUMMARY_THRESHOLD, summaryRequest } from './modules/answer-summary';
import { registerLocalImageScheme, serveLocalImages } from './modules/local-images';

const DEFAULT_SETTINGS: AppSettings = {
  projectsRoot: '',
  doNotDisturb: false,
  alertOnDone: false,
  dockVisible: false,
  dockEdge: 'right',
  overlayVisible: true,
  launchAtLogin: true,
  textScale: 1.1,
  autoUpdate: true,
  autoResume: true,
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
/** An update installs only after this long without any session event. */
const QUIET_BEFORE_UPDATE_MS = 10 * 60 * 1000;
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
  let lastSessionEvent = 0;
  /** Mapping turns wait here and run one at a time, so several new projects never map at once. */
  const mappingQueue: MappingJob[] = [];
  /** The mapping now; `restore` (the card's own model and effort) is set once its turn has been sent. */
  let mappingActive: (MappingJob & { restore: { model: ModelChoice; effort: EffortChoice } | null }) | null = null;
  /** Sessions whose new context window applies once the current turn is done. */
  const awaitingRestart = new Set<string>();
  let quitting = false;

  // ---------- Persistence ----------
  const tagMemory = createTagMemory(join(userData, 'tags'));
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
  // Every Claude process the app starts (sessions and one-shot calls) must use the same executable.
  const claudeExecutable = { pathToClaudeCodeExecutable: packagedClaudeBinary() };
  const engine = createSessionEngine(onSessionEvent, claudeExecutable);
  const structuredQuery = createStructuredQuery(claudeExecutable);
  const todo = createTodoWatcher((id, tree) => {
    model.setTodo(id, tree);
    // The map is done once the agent has written it, even if its turn goes on: the card and schema stop
    // saying "Kartlägger". The model switch back and the held first message still wait for the turn's end.
    if (tree && mappingTurn(id)) model.setMapping(id, false);
    scheduleSync();
  });
  const usage = createUsageMonitor({
    credentialsPath: join(claudeDir, '.credentials.json'),
    onSnapshot: (snapshot) => {
      windows.send('state:usage', snapshot);
      markLimitedFromUsage(snapshot);
    },
  });
  const windows = createWindowManager({
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererUrl: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
    rendererFile: join(__dirname, '../renderer/index.html'),
    icon,
    onMainClose: confirmClose,
    startHidden: process.argv.includes(AUTOSTART_ARG),
  });
  const notifier = createNotifier({ onClick: showSession, flash: (on) => windows.flash(on) });
  const tray = createTray({
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
        // Idle means truly quiet: no turn, no subagent, nothing waiting for the user, and no event from any
        // session for a while (background agents and monitors keep sending events while they work).
        isIdle: () =>
          mappingActive === null &&
          Date.now() - lastSessionEvent >= QUIET_BEFORE_UPDATE_MS &&
          model.summaries().every((s) => s.status !== 'working' && !s.activeAgents && !s.pendingCount && !s.questions.length),
        onStatus: (status) => windows.send('state:update', status),
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
  }
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
      windows.send('state:account', found);
    })
    .catch((error: unknown) => console.warn('Kontot kunde inte läsas; alla modeller visas', error));
  scheduleSync();

  app.on('second-instance', (_event, argv) => {
    if (argv.includes(CHECK_UPDATE_ARG)) updater?.checkNow();
    else windows.showMain();
  });
  app.on('before-quit', quit);

  // ---------- Event flow ----------
  function onSessionEvent(event: SessionEvent): void {
    lastSessionEvent = Date.now();
    for (const entry of model.apply(event)) windows.send('session:transcript-upsert', { id: event.sessionId, entry });
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
      case 'turn_finished': {
        if (record) saveRecord({ ...record, lastActiveAt: new Date().toISOString(), tokensUsed: record.tokensUsed + event.tokens });
        const completed = !event.isError && !event.interrupted;
        const asks = model.summary(event.sessionId);
        if (event.sessionId === QUICK_ID) {
          if (completed) void summarizeQuickAnswer();
          break;
        }
        if (completed) void tagTurn(event.sessionId);
        if (completed && asks?.status === 'waiting' && !asks.pendingCount) {
          // The turn ended with questions: as urgent as a question asked with the tool.
          const body = asks.questions.slice(0, 3).map((q) => q.text).join('\n');
          notifier.alert({ sessionId: event.sessionId, title: `${record?.name ?? 'Session'} har ${asks.questions.length} frågor till dig`, body, urgent: true });
        } else if (settings.alertOnDone && completed) {
          notifier.alert({ sessionId: event.sessionId, title: `${record?.name ?? 'Session'} är klar`, body: event.result, urgent: false });
        }
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
      windows.send('state:sessions', summaries);
      windows.setDock(settings.dockVisible, settings.dockEdge, summaries.length);
      windows.setOverlay(settings.overlayVisible, summaries.length + 1);
      tray.setWaiting(summaries.filter((s) => s.status === 'waiting').length);
      windows.send('state:quick', model.summary(QUICK_ID) ?? null);
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
  function sendToSession(id: string, text: string): void {
    if (engine.isRunning(id)) engine.send(id, text);
    else run(requireRecord(id), text);
  }

  function hasSchema(cwd: string): boolean {
    return existsSync(join(cwd, TODO_RELATIVE_PATH));
  }

  /**
   * Has the session's main agent map its project into the work schema, so the map stays in its own
   * conversation. For that turn it runs on Fable (Opus when the account lacks Fable) with high effort,
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
    const planner: ModelChoice = account.models.some((m) => m.choice === 'fable') ? 'fable' : 'opus';
    const name = planner === 'fable' ? 'Fable' : 'Opus';
    onSessionEvent({ type: 'notice', sessionId: job.id, text: `Huvudagenten kartlägger projektet på ${name} med hög effort och går sedan tillbaka till ${record.model} / ${record.effort}.`, level: 'info' });
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
      sendToSession(s.id, RESUME_MESSAGE);
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
      windows.send('state:quick-summaries', Object.fromEntries(quickSummaries));
    } catch {
      // The full answer shows instead.
    }
  }

  /**
   * Has a cheap model tag the main agent's messages of the turn just finished: the questions and choices
   * put to the user (with options and a short background) and what each block of text is (result, passed check,
   * failure, background …), which the transcript styles and folds by. The text is
   * never rewritten. Apart from what the agent tagged itself ([!QUESTION], [!NOTE]), these are the only questions:
   * plain text is never read as questions by rules.
   */
  async function tagTurn(id: string): Promise<void> {
    const transcript = model.transcript(id);
    const lastUser = [...transcript].reverse().find((e) => e.kind === 'user');
    const from = lastUser ? transcript.indexOf(lastUser) + 1 : 0;
    const all = transcript.slice(from).filter((e): e is Extract<TranscriptEntry, { kind: 'assistant' }> => e.kind === 'assistant' && !e.agentId && !!e.text.trim());
    const messages = messagesForTagging(all.map((e) => e.text));
    const entries = all.slice(-messages.length);
    if (!entries.length) return;
    const before = model.summary(id);
    try {
      const tags = readTags(await structuredQuery(tagRequest(messages, userData, workInProgress(model.summary(id)?.todo ?? null))), messages.map((m) => m.length));
      if (!tags) return;
      tagMemory.remember(id, entries.map((e, i) => ({ text: e.text, tags: tags.tags[i]! })));
      const questions = tags.questions.map((q) => ({ kind: q.kind, text: q.text, about: q.about, detail: entries[q.message - 1]?.text ?? '', brief: q.brief, options: q.options }));
      const blocks = entries.map((e, i) => ({ entryId: e.id, blocks: taggedBlocks(messages[i]!, tags.tags[i]!) }));
      for (const entry of model.applyTurnTags(id, lastUser?.id ?? null, questions, blocks)) windows.send('session:transcript-upsert', { id, entry });
      const after = model.summary(id);
      // New questions get the user's attention.
      if (after && after.questions.length && after.questionsId !== before?.questionsId && !after.pendingCount) {
        notifier.alert({ sessionId: id, title: `${after.name} har ${after.questions.length} frågor till dig`, body: after.questions.slice(0, 3).map((q) => q.text).join('\n'), urgent: true });
      }
      scheduleSync();
    } catch {
      // Without tags only the questions the agent tagged itself stand.
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
    return [groundRules.read().trim(), TODO_PROTOCOL, CALLOUT_PROTOCOL].join('\n\n');
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
        windows.send('session:transcript-reset', { id: record.id, entries: model.transcript(record.id) });
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
    windows.send('ui:open-session', { id });
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
    if (changes.autoUpdate !== undefined) updater?.setAuto(settings.autoUpdate);
    windows.send('state:settings', settings);
    scheduleSync();
    return settings;
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
    ipcMain.handle(channel, (_event, req: IpcInvokeMap[K]['req']) => fn(req));
  }

  handle('app:get-state', () => ({ sessions: model.summaries(), usage: usage.current(), settings, account, update: updateStatus() }));
  handle('update:install', () => updater?.installNow());
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
    windows.send('state:quick-summaries', {});
    await engine.stop(QUICK_ID);
    model.remove(QUICK_ID);
    windows.send('session:transcript-reset', { id: QUICK_ID, entries: [] });
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

  handle('session:send', (req) => sendToSession(req.id, req.text));

  handle('session:answer', (req) => engine.answerQuestion(req.id, req.requestId, req.answers));
  handle('session:permission', (req) => engine.resolvePermission(req.id, req.requestId, req.decision));
  handle('session:interrupt', (req) => engine.interrupt(req.id));
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
  handle('window:snap', (req) => windows.snap(req.mode));
  handle('window:ensure-width', (req) => windows.ensureWidth(req.width));
  handle('window:show-session', (req) => showSession(req.id));
  handle('overlay:set-interactive', (req) => windows.setOverlayInteractive(req.interactive));
  handle('overlay:set-detail', (req) => windows.setOverlayDetail(req.open, req.wide));
  handle('overlay:set-focus', (req) => windows.setOverlayFocus(req.focus));
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
    launchAtLogin: bool(r['launchAtLogin'], d.launchAtLogin),
    autoUpdate: bool(r['autoUpdate'], d.autoUpdate),
    autoResume: bool(r['autoResume'], d.autoResume),
    keepAwake: bool(r['keepAwake'], d.keepAwake),
    theme: pick(r['theme'], THEME_CHOICES, d.theme),
    textScale: typeof r['textScale'] === 'number' && Number.isFinite(r['textScale']) ? clampScale(r['textScale']) : d.textScale,
    defaultModel: pick(r['defaultModel'], MODEL_CHOICES, d.defaultModel),
    defaultEffort: pick(r['defaultEffort'], EFFORT_CHOICES, d.defaultEffort),
    defaultPermissionMode: pick(r['defaultPermissionMode'], PERMISSION_CHOICES, d.defaultPermissionMode),
  };
}

/** Keeps well-formed records and fills in fields that older records lack. */
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
    return [{ ...(r as unknown as SessionRecord), color, effort, focused, lastActiveAt, contextWindow, tokensUsed, limitResetsAt }];
  });
}
