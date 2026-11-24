import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '' }, clipboard: {}, ClipboardItem: class {}, dialog: {}, nativeImage: {} }));

const { mayShareFile, parseRegDefault, SHARE_TYPES } = await import('./index');

const roots = ['C:/proj/demo'];

describe('parseRegDefault', () => {
  it('reads the default value', () => {
    const out = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\App Paths\\OUTLOOK.EXE\r\n    (Default)    REG_SZ    C:\\Program Files\\Office\\OUTLOOK.EXE\r\n    Path    REG_SZ    C:\\x\r\n';
    expect(parseRegDefault(out)).toBe('C:\\Program Files\\Office\\OUTLOOK.EXE');
  });
  it('gives null when there is none', () => expect(parseRegDefault('FEL: hittades inte')).toBeNull());
});

describe('mayShareFile', () => {
  it('allows a listed type inside a root, whatever the case', () => {
    expect(mayShareFile('C:/proj/demo/out/a.csv', roots)).toBe(true);
    expect(mayShareFile('c:\\PROJ\\Demo\\a.PDF', roots)).toBe(true);
  });
  it('refuses traversal out of the root', () => expect(mayShareFile('C:/proj/demo/../other/a.csv', roots)).toBe(false));
  it('refuses dot-folders and dot-files', () => {
    expect(mayShareFile('C:/proj/demo/.git/x.png', roots)).toBe(false);
    expect(mayShareFile('C:/proj/demo/.claude/a.txt', roots)).toBe(false);
  });
  it('refuses paths outside the roots, including a sibling with the same prefix', () => {
    expect(mayShareFile('C:/other/a.csv', roots)).toBe(false);
    expect(mayShareFile('C:/proj/demo2/a.csv', roots)).toBe(false);
  });
  it('refuses other types and relative paths', () => {
    expect(mayShareFile('C:/proj/demo/run.exe', roots)).toBe(false);
    expect(mayShareFile('C:/proj/demo/a.json', roots)).toBe(false);
    expect(mayShareFile('demo/a.csv', roots)).toBe(false);
    expect(Object.keys(SHARE_TYPES)).not.toContain('.json');
  });
});
