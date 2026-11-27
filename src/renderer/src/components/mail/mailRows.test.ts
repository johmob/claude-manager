import { describe, expect, it } from 'vitest';
import { agentActionsDisabled, draftLabel, footerText, rowMark, sourceHint } from './mailRows';

const counts = { junk: 0, bulk: 0, info: 0, reply: 0, action: 0, meeting: 0, private: 0 };

describe('rowMark', () => {
  it('marks action, reply and unjudged', () => {
    expect(rowMark({ category: 'action', needsAction: true, suggestedAction: '' }).tone).toBe('action');
    expect(rowMark({ category: 'reply', needsAction: true, suggestedAction: 'Bekräfta' })).toMatchObject({ tone: 'reply', title: 'Bekräfta' });
    expect(rowMark({ category: 'private', needsAction: false, suggestedAction: '' }).label).toBe('Ej bedömt');
  });
  it('falls back on needsAction', () => {
    expect(rowMark({ category: null, needsAction: true, suggestedAction: '' }).tone).toBe('action');
    expect(rowMark({ category: 'info', needsAction: false, suggestedAction: '' }).tone).toBe('none');
  });
});

describe('draftLabel', () => {
  it('prefers draft state over agent state', () => {
    expect(draftLabel({ draft: 'writing', agent: 'working' })).toBe('Skriver svar…');
    expect(draftLabel({ draft: 'proposed', agent: 'idle' })).toBe('Utkast klart');
    expect(draftLabel({ draft: null, agent: 'working' })).toBe('Agenten jobbar…');
    expect(draftLabel({ draft: null, agent: null })).toBeNull();
  });
});

describe('footerText', () => {
  it('joins the quiet categories', () => {
    expect(footerText({ ...counts, info: 4, junk: 3, bulk: 4 })).toBe('4 info · 7 skräp/utskick');
    expect(footerText(counts)).toBe('');
  });
});

describe('misc', () => {
  it('disables agent actions for private mail', () => {
    expect(agentActionsDisabled({ category: 'private' })).toBe(true);
    expect(agentActionsDisabled({ category: 'reply' })).toBe(false);
  });
  it('describes the source', () => {
    expect(sourceHint({ state: 'outlook-not-running', message: '', at: '' })).toMatchObject({ state: 'idle', title: 'Outlook är inte igång' });
    expect(sourceHint({ state: 'error', message: 'Trasigt', at: '' }).title).toBe('Trasigt');
  });
});
