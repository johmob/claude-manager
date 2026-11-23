import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describeTool, translate } from './index';

const sdk = (message: object): SDKMessage => message as SDKMessage;

describe('translate', () => {
  it('splits assistant content into labelled events', () => {
    const events = translate(
      's',
      sdk({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [
            { type: 'thinking', thinking: 'plan' },
            { type: 'text', text: 'Hej' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test\nmore' } },
          ],
        },
      }),
    );
    expect(events).toEqual([
      { type: 'thinking', sessionId: 's', text: 'plan', agentId: undefined },
      { type: 'text', sessionId: 's', text: 'Hej', agentId: undefined },
      { type: 'tool_use', sessionId: 's', toolUseId: 't1', name: 'Bash', summary: 'npm test', agentId: undefined },
    ]);
  });

  it('maps tool results, results and resets', () => {
    expect(translate('s', sdk({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } }))).toEqual([
      { type: 'tool_result', sessionId: 's', toolUseId: 't1', isError: true },
    ]);
    expect(
      translate('s', sdk({ type: 'result', subtype: 'success', result: 'klart', is_error: false, total_cost_usd: 0.5, duration_ms: 9 })),
    ).toEqual([{ type: 'turn_finished', sessionId: 's', result: 'klart', isError: false, costUsd: 0.5, durationMs: 9 }]);
    expect(translate('s', sdk({ type: 'conversation_reset' }))).toEqual([{ type: 'cleared', sessionId: 's' }]);
  });

  it('keeps only real subagents', () => {
    expect(translate('s', sdk({ type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 'a', description: 'd' }))).toHaveLength(1);
    expect(translate('s', sdk({ type: 'system', subtype: 'task_started', task_type: 'local_bash', task_id: 'b', description: 'd' }))).toHaveLength(0);
    expect(translate('s', sdk({ type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 'c', description: 'd', ambient: true }))).toHaveLength(0);
  });

  it('converts stream rate limits to percent and ISO times', () => {
    const [event] = translate(
      's',
      sdk({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          unifiedWindows: { five_hour: { utilization: 0.05, resetsAt: 1795437000 }, seven_day: { utilization: 0.01, resetsAt: 1795791600 } },
        },
      }),
    );
    expect(event).toEqual({
      type: 'rate_limit',
      sessionId: 's',
      rejected: false,
      windows: {
        fiveHour: { utilization: 5, resetsAt: new Date(1795437000 * 1000).toISOString() },
        sevenDay: { utilization: 1, resetsAt: new Date(1795791600 * 1000).toISOString() },
      },
    });
  });
});

describe('describeTool', () => {
  it('picks the meaningful input field', () => {
    expect(describeTool('Read', { file_path: 'C:\\a.ts' })).toBe('C:\\a.ts');
    expect(describeTool('WebSearch', { query: 'electron' })).toBe('electron');
    expect(describeTool('Unknown', { x: 1 })).toBe('');
  });
});
