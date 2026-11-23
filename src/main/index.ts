// Composition root: the only place that knows every module. It wires modules together with
// callbacks and data, owns persistence of records/settings, and serves the renderer's IPC.
import { app, dialog, ipcMain, nativeImage } from 'electron';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import iconPath from '../../resources/icon.png?asset';
import { DOCK_EDGES, MODEL_CHOICES, PERMISSION_CHOICES } from '../shared/contracts';
import { isRecord } from '../shared/guards';
import type {
  AppSettings,
  IpcInvokeChannel,
  IpcInvokeMap,
  NewSessionOptions,
  SessionEvent,
  SessionKind,
  SessionRecord,
} from '../shared/contracts';
import { createSessionEngine, loadHistory } from './modules/session-engine';
import { createSessionModel } from './modules/session-model';
import { createUsageMonitor } from './modules/usage-monitor';
import { createTodoWatcher, TODO_PROTOCOL } from './modules/todo-tree';
import { createJsonStore } from './modules/json-store';
import { pickColor } from './modules/palette';
import { createGroundRules, groundRulesEditorPrompt } from './modules/ground-rules';
import { createProjects, locateProject } from './modules/projects';
import { structuredQuery } from './modules/structured-query';
import { digestTurn, reviewTurn } from './modules/heads-up';
import { createNotifier } from './modules/notifier';
import { createWindowManager } from './modules/window-manager';
import { createTray } from './modules/tray';

const DEFAULT_SETTINGS: AppSettings = {
  projectsRoot: 'C:\\Kod',
  doNotDisturb: false,
  alertOnDone: false,
  headsUpEnabled: true,
  dockVisible: false,
  dockEdge: 'right',
  overlayVisible: false,
  defaultModel: 'default',
  defaultPermissionMode: 'auto',
};

const SYNC_DELAY_MS = 80;

// Same data folder in development and in the installed app (whose name would otherwise differ).
app.setPath('userData', join(app.getPath('appData'), 'claude-manager'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(boot);
}

function boot(): void {
  app.setAppUserModelId('se.johmob.claude-manager');
  const userData = app.getPath('userData');
  const icon = nativeImage.createFromPath(iconPath);
  let syncTimer: NodeJS.Timeout | null = null;
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
  const engine = createSessionEngine(onSessionEvent, { pathToClaudeCodeExecutable: packagedClaudeBinary() });
  const todo = createTodoWatcher((id, tree) => {
    model.setTodo(id, tree);
    scheduleSync();
  });
  const usage = createUsageMonitor({ onSnapshot: (snapshot) => windows.send('state:usage', snapshot) });
  const windows = createWindowManager({
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererUrl: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
    rendererFile: join(__dirname, '../renderer/index.html'),
    icon,
    onMainClose: confirmClose,
  });
  const notifier = createNotifier({ onClick: showSession, flash: (on) => windows.flash(on) });
  const tray = createTray({ icon, onOpen: () => windows.showMain(), onQuit: quit });

  for (const record of activeRecords()) {
    model.upsertRecord(record);
    todo.watch(record.id, record.cwd);
    if (record.claudeSessionId) {
      loadHistory(record.id, record.claudeSessionId, record.cwd)
        .then((events) => windows.send('session:transcript-reset', { id: record.id, entries: model.loadHistory(record.id, events) }))
        .catch(() => undefined); // No saved transcript (deleted or never written): the card simply starts empty.
    }
  }
  notifier.setDoNotDisturb(settings.doNotDisturb);
  usage.start();
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
      case 'model_changed':
        if (record) saveRecord({ ...record, model: event.model });
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
        break;
      case 'turn_finished':
        if (settings.alertOnDone && !event.isError) {
          notifier.alert({ sessionId: event.sessionId, title: `${record?.name ?? 'Session'} är klar`, body: event.result, urgent: false });
        }
        if (settings.headsUpEnabled && !event.isError && record && record.kind !== 'ground-rules') void reviewForHeadsUp(record);
        break;
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
      tray.setWaiting(summaries.filter((s) => s.pendingCount > 0).length);
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
    records = [...records.filter((r) => r.id !== record.id), record];
    recordStore.write(records);
    if (record.archived) model.remove(record.id);
    else model.upsertRecord(record);
    scheduleSync();
  }

  function requireRecord(id: string): SessionRecord {
    const record = findRecord(id);
    if (!record) throw new Error(`Okänd session: ${id}`);
    return record;
  }

  function composeAppend(): string {
    return `${groundRules.read().trim()}\n\n${TODO_PROTOCOL}`;
  }

  function run(record: SessionRecord, prompt: string | undefined): void {
    engine.start({
      id: record.id,
      cwd: record.cwd,
      model: record.model,
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
      permissionMode: options.permissionMode,
      createdAt: new Date().toISOString(),
      archived: false,
    };
    saveRecord(record);
    todo.watch(id, cwd);
    run(record, options.prompt?.trim() || undefined);
    return id;
  }

  async function reviewForHeadsUp(record: SessionRecord): Promise<void> {
    try {
      const note = await reviewTurn(digestTurn(model.transcript(record.id)), structuredQuery, record.cwd);
      if (note) onSessionEvent({ type: 'heads_up', sessionId: record.id, note });
    } catch (error) {
      // An optional extra: a failed review must never disturb the session itself.
      console.warn('Bra att veta: granskningen misslyckades', error);
    }
  }

  function showSession(id: string): void {
    windows.showMain();
    windows.send('ui:open-session', { id });
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

  handle('app:get-state', () => ({ sessions: model.summaries(), usage: usage.current(), settings }));

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

  handle('session:open-project', (req) => {
    if (!existsSync(req.cwd) || !statSync(req.cwd).isDirectory()) throw new Error(`Mappen finns inte: ${req.cwd}`);
    return createSession('project', req.name?.trim() || basename(req.cwd), req.cwd, req);
  });

  handle('session:send', (req) => {
    if (engine.isRunning(req.id)) engine.send(req.id, req.text);
    else run(requireRecord(req.id), req.text);
  });

  handle('session:answer', (req) => engine.answerQuestion(req.id, req.requestId, req.answers));
  handle('session:permission', (req) => engine.resolvePermission(req.id, req.requestId, req.decision));
  handle('session:interrupt', (req) => engine.interrupt(req.id));
  handle('session:context-usage', (req) => engine.contextUsage(req.id));
  handle('session:transcript', (req) => model.transcript(req.id));

  handle('session:set-model', async (req) => {
    if (engine.isRunning(req.id)) await engine.setModel(req.id, req.model);
    else saveRecord({ ...requireRecord(req.id), model: req.model });
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

  handle('session:mark-seen', (req) => {
    model.markSeen(req.id);
    scheduleSync();
  });

  handle('session:dismiss-heads-up', (req) => {
    model.dismissHeadsUp(req.id);
    scheduleSync();
  });

  handle('ground-rules:edit', (req) => {
    groundRules.ensure();
    const options: NewSessionOptions = {
      model: settings.defaultModel,
      permissionMode: 'acceptEdits',
      prompt: groundRulesEditorPrompt(groundRules.path, req.instructions),
    };
    return createSession('ground-rules', 'Grundregler', userData, options);
  });

  handle('settings:update', (req) => {
    settings = validSettings({ ...settings, ...req }) ?? settings;
    settingsStore.write(settings);
    notifier.setDoNotDisturb(settings.doNotDisturb);
    windows.send('state:settings', settings);
    scheduleSync();
    return settings;
  });

  handle('usage:refresh', () => usage.refreshNow());
  handle('window:snap', (req) => windows.snap(req.mode));
  handle('window:show-session', (req) => showSession(req.id));
  handle('overlay:set-interactive', (req) => windows.setOverlayInteractive(req.interactive));
}

// ---------- Pure helpers ----------

/** In the installed app the SDK's Claude binary sits outside the asar archive; in development the SDK finds it itself. */
function packagedClaudeBinary(): string | undefined {
  if (!app.isPackaged) return undefined;
  return join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe');
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
    headsUpEnabled: bool(r['headsUpEnabled'], d.headsUpEnabled),
    dockVisible: bool(r['dockVisible'], d.dockVisible),
    dockEdge: pick(r['dockEdge'], DOCK_EDGES, d.dockEdge),
    overlayVisible: bool(r['overlayVisible'], d.overlayVisible),
    defaultModel: pick(r['defaultModel'], MODEL_CHOICES, d.defaultModel),
    defaultPermissionMode: pick(r['defaultPermissionMode'], PERMISSION_CHOICES, d.defaultPermissionMode),
  };
}

function validRecords(raw: unknown): SessionRecord[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter(
    (r): r is SessionRecord =>
      isRecord(r) &&
      ['id', 'name', 'color', 'kind', 'cwd', 'model', 'permissionMode', 'createdAt'].every((k) => typeof r[k] === 'string') &&
      typeof r['archived'] === 'boolean',
  );
}
