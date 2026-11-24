// project-drift: notices work done on a project outside the app. The app keeps a git mark of the project
// as it last saw it (HEAD and a fingerprint of uncommitted changes, taken when a turn ends); comparing the
// project with that mark later gives the commits and files changed since, so the work schema and the
// agent's context can catch up. Projects that are not git repositories give no mark and no drift.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { ProjectDrift, ProjectMark } from '../../../shared/contracts';

const MAX_LOG = 30;
const MAX_FILES = 40;

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 20_000 }, (error, stdout) => resolve(error ? null : stdout));
  });
}

const lines = (text: string | null): string[] => (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** The project as it is now: HEAD and a fingerprint of its uncommitted changes; null when it is not a git repository. */
export async function markOf(cwd: string): Promise<ProjectMark | null> {
  const head = (await git(cwd, ['rev-parse', 'HEAD']))?.trim();
  if (!head) return null;
  const [status, diff] = await Promise.all([git(cwd, ['status', '--porcelain']), git(cwd, ['diff', 'HEAD'])]);
  const changes = createHash('sha1').update(`${status ?? ''}\n${diff ?? ''}`).digest('hex');
  return { head, changes };
}

/** What changed since `known`: commits and files, and uncommitted work. Null when nothing did (or it cannot tell). */
export async function driftSince(cwd: string, known: ProjectMark): Promise<ProjectDrift | null> {
  const now = await markOf(cwd);
  if (!now || (now.head === known.head && now.changes === known.changes)) return null;
  const range = `${known.head}..${now.head}`;
  const sameHead = now.head === known.head;
  const [log, files, count, dirty] = await Promise.all([
    sameHead ? Promise.resolve('') : git(cwd, ['log', '--format=%h %s', `-n${MAX_LOG}`, range]),
    sameHead ? Promise.resolve('') : git(cwd, ['diff', '--name-only', known.head, now.head]),
    sameHead ? Promise.resolve('0') : git(cwd, ['rev-list', '--count', range]),
    git(cwd, ['status', '--porcelain']),
  ]);
  const changed = lines(files);
  return {
    mark: now,
    // A rewritten history (the old HEAD is gone) still counts as changed, with no list.
    commits: Number.parseInt(count ?? '', 10) || (sameHead ? 0 : -1),
    log: lines(log),
    files: changed.slice(0, MAX_FILES),
    fileCount: changed.length,
    uncommitted: lines(dirty).length,
  };
}

/** The change list as the agent reads it, in Swedish like the rest of the app's messages. */
export function describeDrift(drift: ProjectDrift): string {
  const parts = [
    drift.commits > 0 ? (drift.commits === 1 ? '1 ny commit' : `${drift.commits} nya commits`) : drift.commits < 0 ? 'git-historiken har skrivits om' : '',
    drift.fileCount ? (drift.fileCount === 1 ? '1 ändrad fil' : `${drift.fileCount} ändrade filer`) : '',
    drift.uncommitted ? `${drift.uncommitted} ${drift.uncommitted === 1 ? 'fil' : 'filer'} med ändringar som inte är committade` : '',
  ].filter(Boolean);
  return [
    `Projektet har ändrats utanför appen sedan du senast arbetade här: ${parts.join(', ') || 'ändringar som inte är committade'}.`,
    ...(drift.log.length ? ['', 'Commits (nyast först):', ...drift.log.map((l) => `- ${l}`)] : []),
    ...(drift.files.length ? ['', `Ändrade filer${drift.fileCount > drift.files.length ? ` (${drift.files.length} av ${drift.fileCount})` : ''}:`, ...drift.files.map((f) => `- ${f}`)] : []),
  ].join('\n');
}
