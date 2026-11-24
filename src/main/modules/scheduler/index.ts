// scheduler: jobs that run on a schedule, owned by the app so they survive restarts (Claude Code's own
// CronCreate jobs live only as long as one session). Each project keeps its jobs in
// .claude-manager/schedule.json, written by its agent (or the app). A job is either a local command, run in
// the project folder without an agent and without tokens, or a task for the project's agent. This module
// reads and writes the file, works out when jobs are due, describes their rhythm and runs commands; the
// composition root decides what a due job does.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Cron } from 'croner';
import type { JobRun, ScheduledJob } from '../../../shared/contracts';

export const SCHEDULE_RELATIVE_PATH = '.claude-manager/schedule.json';
const TICK_MS = 30_000;
const MAX_OUTPUT = 4000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** What agents are told about scheduling, appended to every session's system prompt. */
export const SCHEDULE_PROTOCOL = `# Scheduling work
When the user asks you to do something on a schedule, or you see that something should recur, pick the tool that solves it best:
- The app's schedule (preferred for anything that should keep running): jobs in \`${SCHEDULE_RELATIVE_PATH}\` in the project. The app runs them while it is open, they survive restarts, and the user sees them in the "Schemalagt" side panel in Fokus. Two kinds:
  - "command": a shell command (PowerShell) run in the project folder by the app, with no agent and no tokens. Use it when no judgement is needed: run a script, a build, a test, a backup, a fetch. Set "wakeAgentOnFailure": true to get a message when it fails (non-zero exit); you then get its output.
  - "agent": a task sent to you in this project's session as a message. It costs tokens each time; use it only when the job needs judgement (summarise, review, decide). Keep the task short and self-contained.
- CronCreate (Claude Code): only for short-lived reminders inside this session; its jobs disappear when the session ends or the app restarts, and recurring ones expire after 30 days.
- Monitor (Claude Code): to watch a process, log or command and react when something changes, rather than polling on a schedule.
- Windows Task Scheduler: only for jobs that must run while the app is closed; tell the user, since it lives outside the app.
Format of \`${SCHEDULE_RELATIVE_PATH}\` (keep any jobs already there; give each a stable unique id and a "description" of one or two sentences on what it is for and why, which the user reads when clicking the job):
{ "jobs": [
  { "id": "nightly-tests", "name": "Nattliga tester", "cron": "17 2 * * *", "description": "Kör hela testsviten varje natt och väcker agenten om något går sönder.", "kind": "command", "command": "npm test", "enabled": true, "wakeAgentOnFailure": true },
  { "id": "weekly-summary", "name": "Veckosammanfattning", "cron": "43 8 * * 1", "kind": "agent", "prompt": "Sammanfatta veckans commits och uppdatera arbetsschemat.", "enabled": true }
] }
"cron" is standard 5-field cron in local time (minute hour day-of-month month day-of-week); avoid minute 0 and 30 when the exact time does not matter. Tell the user in one line what you scheduled and how often.`;

/** The project's jobs, and what is wrong with the file if it cannot be read (no file: no jobs). */
export function readJobs(cwd: string): { jobs: ScheduledJob[]; problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(cwd, SCHEDULE_RELATIVE_PATH), 'utf8'));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { jobs: [], problem: missing ? '' : 'Schemafilen går inte att läsa (ogiltig JSON).' };
  }
  const list = typeof raw === 'object' && raw !== null && Array.isArray((raw as { jobs?: unknown }).jobs) ? (raw as { jobs: unknown[] }).jobs : [];
  const jobs = list.flatMap((j): ScheduledJob[] => {
    if (typeof j !== 'object' || j === null) return [];
    const x = j as Record<string, unknown>;
    const str = (k: string): string => (typeof x[k] === 'string' ? (x[k] as string).trim() : '');
    const kind = x['kind'] === 'agent' ? 'agent' : 'command';
    const job: ScheduledJob = {
      id: str('id'),
      name: str('name') || str('id'),
      cron: str('cron'),
      kind,
      command: str('command'),
      prompt: str('prompt'),
      description: str('description'),
      enabled: x['enabled'] !== false,
      wakeAgentOnFailure: x['wakeAgentOnFailure'] === true,
    };
    return job.id && job.cron && (kind === 'agent' ? job.prompt : job.command) ? [job] : [];
  });
  return { jobs, problem: '' };
}

/** Writes the project's jobs back (pausing or removing one from the app). */
export function writeJobs(cwd: string, jobs: ScheduledJob[]): void {
  const file = join(cwd, SCHEDULE_RELATIVE_PATH);
  mkdirSync(dirname(file), { recursive: true });
  const shaped = jobs.map(({ command, prompt, ...job }) => ({ ...job, ...(job.kind === 'agent' ? { prompt } : { command }) }));
  writeFileSync(file, `${JSON.stringify({ jobs: shaped }, null, 2)}\n`, 'utf8');
}

/** The next time after `after` that a cron expression matches; null when it is not valid cron. */
export function nextRunOf(cron: string, after: Date): Date | null {
  try {
    return new Cron(cron, { paused: true }).nextRun(after);
  } catch {
    return null;
  }
}

const DAYS = ['söndagar', 'måndagar', 'tisdagar', 'onsdagar', 'torsdagar', 'fredagar', 'lördagar'];
const pad = (n: string): string => n.padStart(2, '0');

/** How often a job runs, in words: "Var 5:e minut", "Varje timme vid :07", "Vardagar 08:57"; the cron itself when unusual. */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  const num = /^\d+$/;
  const step = /^\*\/(\d+)$/;
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Varje minut';
  if (step.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Var ${step.exec(min)![1]}:e minut`;
  if (num.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Varje timme vid :${pad(min)}`;
  if (num.test(min) && step.test(hour) && dom === '*' && mon === '*' && dow === '*') return `Var ${step.exec(hour)![1]}:e timme vid :${pad(min)}`;
  if (!num.test(min) || !num.test(hour) || mon !== '*') return cron;
  const time = `${pad(hour)}:${pad(min)}`;
  if (dom === '*' && dow === '*') return `Dagligen ${time}`;
  if (dom === '*' && dow === '1-5') return `Vardagar ${time}`;
  if (dom === '*' && (dow === '0,6' || dow === '6,0')) return `Helger ${time}`;
  if (dom === '*' && /^[0-7]$/.test(dow)) return `${DAYS[Number(dow) % 7]!.replace(/^./, (c) => c.toUpperCase())} ${time}`;
  if (num.test(dom) && dow === '*') return `Den ${dom}:e varje månad ${time}`;
  return cron;
}

/** Runs a command in the project folder with PowerShell, without a window; output is cut to its end. */
export function runCommand(cwd: string, command: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<JobRun> {
  const started = Date.now();
  return new Promise((resolve) => {
    let output = '';
    const keep = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT * 2);
    };
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd, windowsHide: true });
    const timer = setTimeout(() => {
      output += '\n[Avbrutet: tog för lång tid]';
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      resolve({ at: new Date(started).toISOString(), ok, output: output.trim().slice(-MAX_OUTPUT), durationMs: Date.now() - started });
    };
    child.on('error', (error) => {
      output += `\n${error.message}`;
      done(false);
    });
    child.on('close', (code) => done(code === 0));
  });
}

export interface SchedulerOptions {
  /** The projects to watch: each card's id and folder. */
  projects: () => Array<{ sessionId: string; cwd: string }>;
  /** A job is due (it ran at most once per matching minute). */
  onDue: (sessionId: string, cwd: string, job: ScheduledJob) => void;
  now?: () => Date;
}

export interface Scheduler {
  stop(): void;
}

/** Checks every half minute which enabled jobs have had a matching time since the last check. */
export function createScheduler(opts: SchedulerOptions): Scheduler {
  const now = opts.now ?? (() => new Date());
  let last = now();
  const tick = (): void => {
    const at = now();
    for (const { sessionId, cwd } of opts.projects()) {
      for (const job of readJobs(cwd).jobs) {
        if (!job.enabled) continue;
        const next = nextRunOf(job.cron, last);
        if (next && next <= at) opts.onDue(sessionId, cwd, job);
      }
    }
    last = at;
  };
  const timer = setInterval(tick, TICK_MS);
  return { stop: () => clearInterval(timer) };
}
