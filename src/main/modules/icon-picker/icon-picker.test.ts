import { describe, expect, it } from 'vitest';
import { iconRequest, readIcon } from './index';

describe('icon picker', () => {
  it('asks a cheap model with the project and its schema titles', () => {
    const request = iconRequest('Gripdon', ['Gripdon v4', 'cad.1 Kåpa'], 'C:\tmp');
    expect(request).toMatchObject({ model: 'haiku', tools: [] });
    expect(request.prompt).toContain('Projekt: Gripdon\n- Gripdon v4\n- cad.1 Kåpa');
  });

  it('accepts only icons from the pool', () => {
    expect(readIcon({ icon: 'cpu' })).toBe('cpu');
    expect(readIcon({ icon: 'no-such-icon' })).toBeNull();
    expect(readIcon(null)).toBeNull();
  });
});
