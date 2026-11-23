import { describe, expect, it } from 'vitest';
import { decide, isInsideSchemaDir } from './index';

const CWD = 'C:\\Kod\\Demonstrator';

describe('isInsideSchemaDir', () => {
  it('accepts files in the schema folder, relative or absolute', () => {
    expect(isInsideSchemaDir('.claude-manager/todo.json', CWD)).toBe(true);
    expect(isInsideSchemaDir('C:\\Kod\\Demonstrator\\.claude-manager\\todo.json', CWD)).toBe(true);
  });

  it('rejects everything else, including escapes', () => {
    expect(isInsideSchemaDir('README.md', CWD)).toBe(false);
    expect(isInsideSchemaDir('.claude-manager/../firmware/main.c', CWD)).toBe(false);
    expect(isInsideSchemaDir('C:\\Kod\\Other\\.claude-manager\\todo.json', CWD)).toBe(false);
    expect(isInsideSchemaDir('.claude-manager', CWD)).toBe(false);
  });
});

describe('decide', () => {
  const allowed = (tool: string, input: Record<string, unknown>) => decide(tool, input, CWD).behavior === 'allow';

  it('lets the planner read and run read-only git', () => {
    expect(allowed('Read', { file_path: 'firmware/main.c' })).toBe(true);
    expect(allowed('Grep', { pattern: 'TODO' })).toBe(true);
    expect(allowed('Bash', { command: 'git log --oneline -50' })).toBe(true);
  });

  it('denies writing outside the schema and every other command', () => {
    expect(allowed('Write', { file_path: '.claude-manager/todo.json' })).toBe(true);
    expect(allowed('Write', { file_path: 'firmware/main.c' })).toBe(false);
    expect(allowed('Bash', { command: 'git push' })).toBe(false);
    expect(allowed('Bash', { command: 'rm -rf build' })).toBe(false);
    expect(allowed('WebFetch', { url: 'https://example.com' })).toBe(false);
  });
});
