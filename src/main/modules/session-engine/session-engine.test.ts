import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { briefSubagents, describeTool, savedUserText, splitCallouts, translate } from './index';

const sdk = (message: object): SDKMessage => message as SDKMessage;

describe('translate', () => {
  it('gives every subagent the brief as context', async () => {
    const hook = briefSubagents('REGLER');
    const signal = new AbortController().signal;
    expect(await hook({ hook_event_name: 'SubagentStart', agent_id: 'a', agent_type: 'general-purpose' } as never, undefined, { signal })).toEqual({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: 'REGLER' } });
    expect(await hook({ hook_event_name: 'Stop' } as never, undefined, { signal })).toEqual({});
  });

  it('reads what CronCreate asked for and the job it made', () => {
    const [use] = translate('s', sdk({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't9', name: 'CronCreate', input: { cron: '17 9 * * 1', prompt: 'Sammanfatta veckan', durable: true } }] } }));
    expect(use).toMatchObject({ type: 'tool_use', cron: { kind: 'create', cron: '17 9 * * 1', prompt: 'Sammanfatta veckan', recurring: true, durable: true } });
    const [done] = translate('s', sdk({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't9' }] }, tool_use_result: { id: 'ab12', humanSchedule: 'måndagar 09:17', recurring: true, nextFireAt: 5 } }));
    expect(done).toMatchObject({ type: 'tool_result', cronJob: { id: 'ab12', schedule: 'måndagar 09:17', nextFireAt: 5 } });
  });

  it('reports compacting as it starts, fails and ends', () => {
    expect(translate('s', sdk({ type: 'system', subtype: 'status', status: 'compacting' }))).toEqual([{ type: 'compacting', sessionId: 's', active: true }]);
    expect(translate('s', sdk({ type: 'system', subtype: 'status', status: 'requesting' }))).toEqual([]);
    expect(translate('s', sdk({ type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'för stort' }))).toEqual([{ type: 'compacting', sessionId: 's', active: false, error: 'för stort' }]);
    expect(translate('s', sdk({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 412000, post_tokens: 38000, duration_ms: 72000 } }))).toEqual([
      { type: 'compacted', sessionId: 's', preTokens: 412000, postTokens: 38000, durationMs: 72000 },
    ]);
  });

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
      translate('s', sdk({ type: 'result', subtype: 'success', result: 'klart', is_error: false, duration_ms: 9, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } })),
    ).toEqual([{ type: 'turn_finished', sessionId: 's', result: 'klart', isError: false, interrupted: false, tokens: 135, durationMs: 9, usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 20 } }]);
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
      resetsAt: null,
      windows: {
        fiveHour: { utilization: 5, resetsAt: new Date(1795437000 * 1000).toISOString() },
        sevenDay: { utilization: 1, resetsAt: new Date(1795791600 * 1000).toISOString() },
      },
    });
  });
});

describe('splitCallouts', () => {
  it('separates GitHub alert blocks from the answer', () => {
    const text = [
      'Done',
      '',
      '> [!WARNING]',
      '> **Steg 2 misslyckades.** `settings-prod.json` finns inte.',
      '',
      '> [!NOTE]',
      '> **Filen skapades från grunden:** den innehåller bara `port`.',
    ].join('\n');
    expect(splitCallouts(text)).toEqual({
      text: 'Done',
      callouts: [
        { kind: 'warning', title: 'Steg 2 misslyckades', text: '`settings-prod.json` finns inte.' },
        { kind: 'note', title: 'Filen skapades från grunden', text: 'Den innehåller bara `port`.' },
      ],
    });
  });

  it('accepts text on the marker line and blocks without a bold title', () => {
    expect(splitCallouts('> [!CAUTION] Lösenordet loggas.').callouts).toEqual([{ kind: 'caution', title: '', text: 'Lösenordet loggas.' }]);
  });

  it('ignores alert syntax inside code fences and plain quotes', () => {
    const text = ['```md', '> [!TIP]', '> exempel', '```', '> bara ett citat'].join('\n');
    expect(splitCallouts(text)).toEqual({ text, callouts: [] });
  });

  it('turns tagged assistant text into text plus callout events', () => {
    const events = translate('s', sdk({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Klart.\n\n> [!TIP]\n> **Nästa steg:** kör testerna.' }] } }));
    expect(events.map((e) => e.type)).toEqual(['text', 'callout']);
  });
});

describe('describeTool', () => {
  it('picks the meaningful input field', () => {
    expect(describeTool('Read', { file_path: 'C:\\a.ts' })).toBe('C:\\a.ts');
    expect(describeTool('WebSearch', { query: 'electron' })).toBe('electron');
    expect(describeTool('Unknown', { x: 1 })).toBe('');
  });
});

describe('savedUserText', () => {
  it('shows what the user wrote as theirs, and Claude Code\'s own messages not', () => {
    expect(savedUserText('s', 'Kör vidare')).toEqual([{ type: 'turn_started', sessionId: 's', prompt: 'Kör vidare' }]);
    const notification = '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<summary>Agent "B: Sensordrivrutin" finished</summary>\n</task-notification>';
    expect(savedUserText('s', notification)).toEqual([{ type: 'notice', sessionId: 's', text: 'Subagenten "B: Sensordrivrutin" är klar.', level: 'info' }]);
    expect(savedUserText('s', '<local-command-caveat>The command below was run directly</local-command-caveat>')).toEqual([]);
    expect(savedUserText('s', '<system-reminder>x</system-reminder>')).toEqual([]);
  });
});

describe('callout text under a title', () => {
  it('starts with a capital letter, since it shows as a paragraph of its own', () => {
    expect(splitCallouts('> [!NOTE]\n> **Ligger kvar:** det skickades innan.').callouts).toEqual([{ kind: 'note', title: 'Ligger kvar', text: 'Det skickades innan.' }]);
  });
});

describe('a bold start that runs on into the sentence', () => {
  it('is not split into a title and a text', () => {
    const body = '> [!IMPORTANT]\n> **Koppla in avtryckaren med 24 V avslaget**, och isolera ledarna 6–8 var för sig.';
    expect(splitCallouts(body).callouts).toEqual([{ kind: 'important', title: '', text: '**Koppla in avtryckaren med 24 V avslaget**, och isolera ledarna 6–8 var för sig.' }]);
    expect(splitCallouts('> [!NOTE]\n> **Titel.** Text här.').callouts).toEqual([{ kind: 'note', title: 'Titel', text: 'Text här.' }]);
    expect(splitCallouts('> [!NOTE]\n> **Titel** – text här.').callouts).toEqual([{ kind: 'note', title: 'Titel', text: 'Text här.' }]);
  });
});
