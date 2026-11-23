import { describe, expect, it } from 'vitest';
import { readSummary, summaryRequest } from './index';

describe('answer summary', () => {
  it('asks a cheap model with the question and the answer', () => {
    const request = summaryRequest('Vad är MTBF?', 'MTBF är medeltid mellan fel.', 'C:\\tmp');
    expect(request).toMatchObject({ model: 'haiku', tools: [] });
    expect(request.prompt).toContain('Fråga: Vad är MTBF?');
    expect(request.prompt).toContain('MTBF är medeltid mellan fel.');
  });

  it('reads the summary and tolerates a bad reply', () => {
    expect(readSummary({ summary: ' Kort svar. ' })).toBe('Kort svar.');
    expect(readSummary({ summary: 'x'.repeat(500) }).length).toBe(420);
    expect(readSummary(null)).toBe('');
  });
});
