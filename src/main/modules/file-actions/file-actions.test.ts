import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '' }, clipboard: {}, ClipboardItem: class {}, dialog: {}, nativeImage: {} }));

const { parseRegDefault } = await import('./index');

describe('parseRegDefault', () => {
  it('reads the default value', () => {
    const out = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\App Paths\\OUTLOOK.EXE\r\n    (Default)    REG_SZ    C:\\Program Files\\Office\\OUTLOOK.EXE\r\n    Path    REG_SZ    C:\\x\r\n';
    expect(parseRegDefault(out)).toBe('C:\\Program Files\\Office\\OUTLOOK.EXE');
  });
  it('gives null when there is none', () => expect(parseRegDefault('FEL: hittades inte')).toBeNull());
});
