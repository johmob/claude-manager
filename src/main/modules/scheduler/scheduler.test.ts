import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeCron, nextRunOf, readJobs, runCommand, writeJobs } from './index';

describe('scheduler', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const project = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-sched-'));
    dirs.push(dir);
    return dir;
  };

  it('describes common rhythms in words', () => {
    expect(describeCron('* * * * *')).toBe('Varje minut');
    expect(describeCron('*/5 * * * *')).toBe('Var 5:e minut');
    expect(describeCron('7 * * * *')).toBe('Varje timme vid :07');
    expect(describeCron('57 8 * * *')).toBe('Dagligen 08:57');
    expect(describeCron('57 8 * * 1-5')).toBe('Vardagar 08:57');
    expect(describeCron('43 8 * * 1')).toBe('Måndagar 08:43');
    expect(describeCron('5 4 1 * *')).toBe('Den 1:e varje månad 04:05');
    expect(describeCron('5 4 1 1 *')).toBe('5 4 1 1 *');
  });

  it('finds the next run and rejects what is not cron', () => {
    const next = nextRunOf('57 8 * * *', new Date(2026, 10, 24, 9, 0));
    expect(next?.getDate()).toBe(25);
    expect(next?.getHours()).toBe(8);
    expect(nextRunOf('inte cron', new Date())).toBeNull();
  });

  it('reads valid jobs, skips incomplete ones, and writes them back', () => {
    const dir = project();
    mkdirSync(join(dir, '.claude-manager'));
    writeFileSync(join(dir, '.claude-manager/schedule.json'), JSON.stringify({ jobs: [
      { id: 'tests', name: 'Tester', cron: '17 2 * * *', kind: 'command', command: 'npm test', wakeAgentOnFailure: true },
      { id: 'summary', cron: '43 8 * * 1', kind: 'agent', prompt: 'Sammanfatta veckan.', enabled: false },
      { id: 'broken', cron: '1 * * * *', kind: 'command' },
    ] }));
    const { jobs } = readJobs(dir);
    expect(jobs.map((j) => [j.id, j.name, j.kind, j.enabled, j.wakeAgentOnFailure])).toEqual([
      ['tests', 'Tester', 'command', true, true],
      ['summary', 'summary', 'agent', false, false],
    ]);
    writeJobs(dir, jobs.filter((j) => j.id !== 'tests'));
    expect(readJobs(dir).jobs.map((j) => j.id)).toEqual(['summary']);
    expect(readJobs(project())).toEqual({ jobs: [], problem: '' });
  });

  it('runs a command in the project folder and reports how it went', async () => {
    const dir = project();
    const ok = await runCommand(dir, 'Write-Output hej');
    expect(ok).toMatchObject({ ok: true, output: 'hej' });
    const failed = await runCommand(dir, 'exit 3');
    expect(failed.ok).toBe(false);
  }, 30_000);
});
