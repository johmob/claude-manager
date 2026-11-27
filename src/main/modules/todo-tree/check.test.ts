import { describe, expect, it } from 'vitest';
import { parseTodoTree } from './index';
import { checkSchema, schemaReminder } from './check';

const tree = (items: unknown[], title = 'Spår') => parseTodoTree(JSON.stringify({ tracks: [{ id: 't', title, notes: 'Anteckning', items }] }))!;
const leaf = (o: Record<string, unknown>) => ({ id: 'a', title: 'Punkt', status: 'not_started', notes: 'ok', ...o });
const check = (items: unknown[], agentsWorking = true) => checkSchema(tree(items), { agentsWorking });

describe('checkSchema', () => {
  it('is quiet for a tidy schema', () => {
    expect(check([leaf({ status: 'done', notes: 'Klart och provat' })])).toEqual([]);
  });

  it('flags a done item whose note says it is untested or left', () => {
    for (const notes of ['Ej provat', 'inte testat än', 'Det är mycket kvar', 'Återstår: test', 'not tested']) {
      expect(check([leaf({ id: 'fw.2', status: 'done', notes })])[0]).toContain('fw.2 är klar');
    }
    expect(check([leaf({ status: 'not_started', notes: 'Ej provat' })])).toEqual([]);
    expect(check([leaf({ status: 'done', notes: 'Provat på riktigt' })])).toEqual([]);
  });

  it('flags in-progress items only while no agent works', () => {
    const items = [leaf({ id: 'x.1', status: 'in_progress' })];
    expect(check(items, false)[0]).toContain('x.1 står som pågår');
    expect(check(items, true)).toEqual([]);
  });

  it('flags empty notes', () => {
    expect(check([leaf({ id: 'n.1', notes: '' })])[0]).toContain('n.1');
  });

  it('flags long titles', () => {
    expect(check([leaf({ id: 'l.1', title: 'En titel som har alldeles för många ord' })])[0]).toContain('l.1 har för lång titel');
    expect(check([leaf({ id: 'l.2', title: 'Ordlösningsimplementeringsframställningsverktyget' })])[0]).toContain('l.2');
    expect(check([leaf({ title: 'Fem ord är helt okej' })])).toEqual([]);
  });

  it('flags a level that mixes items and groups', () => {
    const found = check([leaf({ id: 'm.1' }), leaf({ id: 'm.2', items: [leaf({ id: 'm.2.1' })] })]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('blandar');
  });

  it('skips Klart rows', () => {
    expect(check([leaf({ id: 'k', title: 'Klart (3)', status: 'done', notes: '', items: [leaf({ status: 'done', notes: 'kvar' })] })])).toEqual([]);
  });

  it('caps the list', () => {
    const items = Array.from({ length: 12 }, (_, i) => leaf({ id: `c.${i}`, notes: '' }));
    const found = check(items);
    expect(found).toHaveLength(9);
    expect(found[8]).toBe('… och 4 till');
  });
});

describe('schemaReminder', () => {
  it('is null when there is nothing to say', () => {
    expect(schemaReminder([], false)).toBeNull();
  });
  it('keeps the untouched text', () => {
    const text = schemaReminder([], true)!;
    expect(text).toContain('utan att röra arbetsschemat');
    expect(text.endsWith('Nämn det inte i chatten.')).toBe(true);
  });
  it('lists the findings', () => {
    const text = schemaReminder(['a.1 saknar anteckning'], false)!;
    expect(text).toContain('Rätta i arbetsschemat:\n- a.1 saknar anteckning');
    expect(text.endsWith('Nämn det inte i chatten.')).toBe(true);
  });
});
