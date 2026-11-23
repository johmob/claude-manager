// Composition root: the only place that knows every module. It wires modules together with
// callbacks and data, owns persistence of records/settings, and serves the renderer's IPC.
import { app, dialog, ipcMain, nativeImage } from 'electron';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import iconPath from '../../resources/icon.png?asset';
import { CONTEXT_WINDOW_CHOICES, DOCK_EDGES, EFFORT_CHOICES, MODEL_CHOICES, PERMISSION_CHOICES } from '../shared/contracts';
import { isRecord } from '../shared/guards';
import type {
  AppSettings,
  EffortChoice,
  ImportCandidate,
  ModelChoice,
  IpcInvokeChannel,
  IpcInvokeMap,
  NewSessionOptions,
  SessionEvent,
  SessionKind,
  SessionRecord,
} from '../shared/contracts';
import { CALLOUT_PROTOCOL, createSessionEngine, loadHistory } from './modules/session-engine';
import { createSessionModel } from './modules/session-model';
import { createUsageMonitor } from './modules/usage-monitor';
import { createTodoWatcher, mappingRequest, TODO_PROTOCOL, TODO_RELATIVE_PATH } from './modules/todo-tree';
import { createJsonStore } from './modules/json-store';
import { pickColor } from './modules/palette';
import { createGroundRules, groundRulesEditorPrompt } from './modules/ground-rules';
import { createProjects, locateProject } from './modules/projects';
import { createStructuredQuery } from './modules/structured-query';
import { createNotifier } from './modules/notifier';
import { createWindowManager } from './modules/window-manager';
import { createTray } from './modules/tray';
import { importCandidates, liveTerminals } from './modules/terminal-sessions';
import { probeAccount, UNVERIFIED_ACCOUNT } from './modules/account';
import { bringIntoFocus, expireFocus } from './modules/focus-rules';

const DEFAULT_SETTINGS: AppSettings = {
  projectsRoot: 'C:\\Kod',
  doNotDisturb: false,
  alertOnDone: false,
  dockVisible: false,
  dockEdge: 'right',
  overlayVisible: true,
  launchAtLogin: true,
  textScale: 1.1,
  defaultModel: 'opus',
  defaultEffort: 'medium',
  defaultPermissionMode: 'auto',
};

const SYNC_DELAY_MS = 80;

/** Given to the app when Windows starts it at login, so it starts in the tray instead of opening its window. */
const AUTOSTART_ARG = '--autostart';

/** A project waiting to be mapped by its session's main agent, with the user's first message held until then. */
interface MappingJob {
  id: string;
  guidance: string;
  firstPrompt?: string;
}

// Same data folder in development and in the installed app (whose name would otherwise differ).
// CLAUDE_MANAGER_DATA_DIR gives a test run its own folder, so it never touches (or locks out) the real app.
app.setPath('userData', process.env['CLAUDE_MANAGER_DATA_DIR'] || join(app.getPath('appData'), 'claude-manager'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(boot);
}

function boot(): void {
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
  const settingsStore = createJsonStore(join(userData, 'settings.json'), DEFAULT_SETTINGS, validSettings);
  const recordStore = createJsonStore<SessionRecord[]>(join(userData, 'sessions.json'), [], validRecords);
  let settings = settingsStore.read();
  let records = recordStore.read();
  const groundRules = createGroundRules(join(userData, 'base-CLAUDE.md'));
  const projects = createProjects(() => settings.projectsRoot);

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
    onSnapshot: (snapshot) => windows.send('state:usage', snapshot),
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

  for (const record of activeRecords()) {
    model.upsertRecord(record);
    todo.watch(record.id, record.cwd);
    loadSavedHistory(record);
  }
  notifier.setDoNotDisturb(settings.doNotDisturb);
  usage.start();
  // Sessions without work for days leave Fokus: checked at start and then every hour.
  const expireStale = (): void => saveRecords(expireFocus(records, Date.now()));
  expireStale();
  const focusTimer = setInterval(expireStale, 60 * 60 * 1000);
  let account = UNVERIFIED_ACCOUNT;
  probeAccount({ cwd: userData, ...claudeExecutable })
    .then((found) => {
      account = found;
      windows.send('state:account', found);
    })
    .catch((error: unknown) => console.warn('Kontot kunde inte läsas; alla modeller visas', error));
  scheduleSync();

  app.on('second-instance', () => windows.showMain());
  app.on('before-quit', quit);

  // ---------- Event flow ----------
  function onSessionEvent(event: SessionEvent): void {
    for (const entry of model.apply(event)) windows.send('session:transcript-upsert', { id: event.sessionId, entry });
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
      windows.setOverlay(settings.overlayVisible, summaries.length);
      tray.setWaiting(summaries.filter((s) => s.status === 'waiting').length);
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

  /** Puts a saved conversation in front of the card's transcript (no tokens; local files). */
  function loadSavedHistory(record: SessionRecord): void {
    if (!record.claudeSessionId) return;
    loadHistory(record.id, record.claudeSessionId, record.cwd)
      .then((events) => windows.send('session:transcript-reset', { id: record.id, entries: model.loadHistory(record.id, events) }))
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

  handle('app:get-state', () => ({ sessions: model.summaries(), usage: usage.current(), settings, account }));

  handle('session:new-chat', (req) => {
    const id = randomUUID();
    const cwd = join(userData, 'chats', id);
    mkdirSync(cwd, { recursive: true });
    const name = req.name?.trim() || `Chatt ${new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
    return createSession('chat', name, cwd, req, id);
  });

  handle('session:new-project', (req) => {
    const cwd = projects.create(req.name);
    const name = basename(cwd);
    const prompt = req.createGitRepo ? [gitSetupPrompt(name), req.prompt?.trim()].filter(Boolean).join('\n\nAfter that: ') : req.prompt;
    return createSession('project', name, cwd, { ...req, prompt });
  });

  handle('session:locate-project', async (req) => {
    const candidates = projects.list();
    const found = await locateProject(settings.projectsRoot, req.description, candidates, structuredQuery);
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

  handle('session:archive', (req) => {
    engine.stop(req.id);
    todo.unwatch(req.id);
    notifier.clear(req.id);
    saveRecord({ ...requireRecord(req.id), archived: true });
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

  handle('usage:refresh', () => usage.refreshNow());
  handle('window:snap', (req) => windows.snap(req.mode));
  handle('window:ensure-width', (req) => windows.ensureWidth(req.width));
  handle('window:show-session', (req) => showSession(req.id));
  handle('overlay:set-interactive', (req) => windows.setOverlayInteractive(req.interactive));
  handle('overlay:set-detail', (req) => windows.setOverlayDetail(req.open));
  handle('popup:open', (req) => windows.openPopup(req));
  handle('popup:close', () => windows.closePopup());
  handle('popup:current', () => windows.popupView());
}

// ---------- Pure helpers ----------

/** In the installed app the SDK's Claude binary sits outside the asar archive; in development the SDK finds it itself. */
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
    projectsRoot: typeof r['projectsRoot'] === 'string' && r['projectsRoot'] ? r['projectsRoot'] : d.projectsRoot,
    doNotDisturb: bool(r['doNotDisturb'], d.doNotDisturb),
    alertOnDone: bool(r['alertOnDone'], d.alertOnDone),
    dockVisible: bool(r['dockVisible'], d.dockVisible),
    dockEdge: pick(r['dockEdge'], DOCK_EDGES, d.dockEdge),
    overlayVisible: bool(r['overlayVisible'], d.overlayVisible),
    launchAtLogin: bool(r['launchAtLogin'], d.launchAtLogin),
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
    return [{ ...(r as unknown as SessionRecord), effort, focused, lastActiveAt, contextWindow, tokensUsed }];
  });
}
