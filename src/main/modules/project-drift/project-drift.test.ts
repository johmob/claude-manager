import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeDrift, driftSince, markOf } from './index';

describe('project drift', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const repo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-drift-'));
    dirs.push(dir);
    const git = (...args: string[]): void => void execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: dir });
    git('init', '-q');
    writeFileSync(join(dir, 'a.txt'), 'ett');
    git('add', '.');
    git('commit', '-q', '-m', 'Första');
    return dir;
  };
  const commit = (dir: string, file: string, message: string): void => {
    writeFileSync(join(dir, file), message);
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', message], { cwd: dir });
  };

  it('finds commits, files and uncommitted work made since the mark', async () => {
    const dir = repo();
    const known = (await markOf(dir))!;
    expect(await driftSince(dir, known)).toBeNull();
    commit(dir, 'b.txt', 'Lade till b');
    writeFileSync(join(dir, 'a.txt'), 'ändrad');
    const drift = (await driftSince(dir, known))!;
    expect(drift).toMatchObject({ commits: 1, fileCount: 1, files: ['b.txt'], uncommitted: 1 });
    expect(drift.log[0]).toMatch(/Lade till b$/);
    expect(describeDrift(drift)).toContain('1 ny commit, 1 ändrad fil, 1 fil med ändringar som inte är committade');
  }, 30_000);

  it('gives no mark for a folder that is not a git repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-nogit-'));
    dirs.push(dir);
    expect(await markOf(dir)).toBeNull();
  });
});
