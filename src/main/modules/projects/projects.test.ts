import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProjects, sanitizeFolderName } from './index';

describe('sanitizeFolderName', () => {
  it('strips invalid characters and collapses whitespace', () => {
    expect(sanitizeFolderName('  My: <cool>   app?. ')).toBe('My cool app');
  });

  it('rejects empty and reserved names', () => {
    expect(() => sanitizeFolderName(' ?? ')).toThrow('Ogiltigt projektnamn');
    expect(() => sanitizeFolderName('con')).toThrow('Ogiltigt projektnamn');
    expect(() => sanitizeFolderName('LPT3')).toThrow('Ogiltigt projektnamn');
  });
});

describe('projects', () => {
  it('lists visible directories sorted case-insensitively', () => {
    const root = mkdtempSync(join(tmpdir(), 'proj-'));
    ['beta', 'Alpha', '.hidden'].forEach((d) => mkdirSync(join(root, d)));
    writeFileSync(join(root, 'file.txt'), '');
    expect(createProjects(() => root).list()).toEqual([join(root, 'Alpha'), join(root, 'beta')]);
  });

  it('returns [] for a missing root', () => {
    expect(createProjects(() => join(tmpdir(), 'nope-does-not-exist-xyz')).list()).toEqual([]);
  });

  it('creates a folder and refuses duplicates', () => {
    const root = mkdtempSync(join(tmpdir(), 'proj-'));
    const projects = createProjects(() => root);
    const path = projects.create('New: app');
    expect(existsSync(path)).toBe(true);
    expect(path).toBe(join(root, 'New app'));
    expect(() => projects.create('New app')).toThrow('Mappen finns redan');
  });
});
