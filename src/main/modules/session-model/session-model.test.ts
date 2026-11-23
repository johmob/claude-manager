import { describe, expect, it } from 'vitest';
import type { SessionEvent, SessionRecord, TodoNode, TodoTree } from '../../../shared/contracts';
import { createSessionModel, findQuestions } from './index';

const record: SessionRecord = {
  id: 's1',
  name: 'Test',
  color: '#fff',
  kind: 'chat',
  cwd: 'C:\\tmp',
  model: 'haiku',
  effort: 'default',
  permissionMode: 'default',
  createdAt: '2026-11-23T00:00:00Z',
  archived: false,
  focused: false,
  lastActiveAt: '2026-11-23T00:00:00Z',
  contextWindow: 'auto',
  tokensUsed: 0,
};

type EventBody = SessionEvent extends infer E ? (E extends SessionEvent ? Omit<E, 'sessionId'> : never) : never;

function setup() {
  const model = createSessionModel(() => 1000);
  model.upsertRecord(record);
  const apply = (event: EventBody) => model.apply({ ...event, sessionId: 's1' } as SessionEvent);
  return { model, apply };
}

describe('session-model', () => {
  it('starts stopped and resumable', () => {
    const { model } = setup();
    expect(model.summary('s1')).toMatchObject({ status: 'stopped', resumable: true, activeAgents: 0 });
  });

  it('goes working -> waiting -> working -> done -> idle', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    expect(model.summary('s1')?.status).toBe('idle');
    apply({ type: 'turn_started', prompt: 'hej' });
    expect(model.summary('s1')).toMatchObject({ status: 'working', activeAgents: 1, turnStartedAt: 1000 });
    apply({ type: 'input_requested', pending: { kind: 'permission', requestId: 'r1', toolName: 'Bash', summary: 'Bash: ls', detail: 'ls', createdAt: 0 } });
    expect(model.summary('s1')).toMatchObject({ status: 'waiting', pendingCount: 1 });
    const resolved = apply({ type: 'input_resolved', requestId: 'r1', answer: 'Godkänd' });
    expect(resolved[0]).toMatchObject({ kind: 'system', text: 'Godkänd: Bash: ls' });
    expect(model.summary('s1')?.status).toBe('working');
    apply({ type: 'turn_finished', result: 'klart', isError: false, interrupted: false, tokens: 1200, durationMs: 5 });
    expect(model.summary('s1')).toMatchObject({ status: 'done', turnStartedAt: null });
    model.markSeen('s1');
    expect(model.summary('s1')?.status).toBe('idle');
  });

  it('attaches thinking to the next message and updates tool status', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'thinking', text: 'hmm' });
    const [tool] = apply({ type: 'tool_use', toolUseId: 't1', name: 'Bash', summary: 'npm test' });
    expect(tool).toMatchObject({ kind: 'tool', status: 'running', thinking: 'hmm' });
    expect(model.summary('s1')?.currentTask).toBe('Bash: npm test');
    const [updated] = apply({ type: 'tool_result', toolUseId: 't1', isError: true });
    expect(updated).toMatchObject({ id: tool!.id, status: 'error' });
    const [text] = apply({ type: 'text', text: 'svar' });
    expect(text).toMatchObject({ kind: 'assistant', thinking: '' });
  });

  it('records question answers on the question entry', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    const [q] = apply({
      type: 'input_requested',
      pending: { kind: 'question', requestId: 'q1', createdAt: 0, questions: [{ question: 'Röd eller blå?', header: 'Färg', multiSelect: false, options: [] }] },
    });
    expect(q).toMatchObject({ kind: 'question', text: 'Röd eller blå?', answer: null });
    const [answered] = apply({ type: 'input_resolved', requestId: 'q1', answer: 'Blå' });
    expect(answered).toMatchObject({ id: q!.id, answer: 'Blå' });
    expect(model.transcript('s1')).toHaveLength(1);
  });

  it('counts subagents and prefers the todo tree for the current task', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'bygg' });
    apply({ type: 'subagent_started', taskId: 'a', description: 'research' });
    apply({ type: 'subagent_started', taskId: 'b', description: 'tests' });
    expect(model.summary('s1')).toMatchObject({ activeAgents: 3, agentCount: 3 });
    apply({ type: 'subagent_finished', taskId: 'a' });
    expect(model.summary('s1')).toMatchObject({ activeAgents: 2, agentCount: 3 });
    apply({ type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 });
    expect(model.summary('s1')).toMatchObject({ activeAgents: 1, agentCount: 2 });
    apply({ type: 'turn_started', prompt: 'mer' });
    expect(model.summary('s1')?.agentCount).toBe(2);
    apply({ type: 'subagent_finished', taskId: 'b' });
    expect(model.summary('s1')).toMatchObject({ activeAgents: 1, agentCount: 2 });
    const item = (id: string, title: string, status: TodoNode['status'], children: TodoNode[] = []): TodoNode => ({
      id,
      title,
      status,
      progress: 0,
      owner: '',
      dependsOn: [],
      blocked: false,
      notes: '',
      children,
    });
    const tree: TodoTree = {
      title: 'x',
      updated: '',
      progress: 0,
      doneItems: 0,
      inProgressItems: 0,
      totalItems: 3,
      tracks: [
        item('cad', 'CAD', 'done'),
        item('fw', 'Firmware', 'in_progress', [item('fw.1', 'SPI', 'done'), item('fw.2', 'Protokoll', 'in_progress')]),
        item('web', 'Webb', 'in_progress'),
      ],
    };
    model.setTodo('s1', tree);
    expect(model.summary('s1')?.currentTask).toBe('fw.2 Protokoll (+1 parallellt)');
  });

  it('prepends saved history without changing live status', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'ny fråga' });
    const full = model.loadHistory('s1', [
      { type: 'turn_started', sessionId: 's1', prompt: 'gammal fråga' },
      { type: 'text', sessionId: 's1', text: 'gammalt svar' },
    ]);
    expect(full.map((e) => (e.kind === 'user' || e.kind === 'assistant' ? e.text : e.kind))).toEqual(['gammal fråga', 'gammalt svar', 'ny fråga']);
    expect(full[0]!.id.startsWith('history:')).toBe(true);
    expect(model.summary('s1')).toMatchObject({ status: 'working', activeAgents: 1 });
  });

  it('keeps the latest turn\'s callouts, most severe first, until dismissed or the next turn', () => {
    const { model, apply } = setup();
    apply({ type: 'turn_started', prompt: 'bygg' });
    const [entry] = apply({ type: 'callout', callout: { kind: 'note', title: 'Antog port 80', text: 'Ingen port angavs.' } });
    apply({ type: 'callout', callout: { kind: 'caution', title: 'Lösenord i klartext', text: 'config.json.' } });
    expect(entry).toMatchObject({ kind: 'callout', callout: { kind: 'note' } });
    expect(model.summary('s1')?.callouts.map((c) => c.kind)).toEqual(['caution', 'note']);
    model.dismissCallouts('s1');
    expect(model.summary('s1')?.callouts).toEqual([]);
    apply({ type: 'callout', callout: { kind: 'tip', title: 'Nästa steg', text: 'Lägg till tester.' } });
    apply({ type: 'turn_started', prompt: 'nästa' });
    expect(model.summary('s1')?.callouts).toEqual([]);
  });

  it('treats an interrupted turn as stopped work, not as an error or a finished task', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'lång uppgift' });
    const [entry] = apply({ type: 'turn_finished', result: '', isError: false, interrupted: true, tokens: 0, durationMs: 1 });
    expect(entry).toMatchObject({ kind: 'system', text: 'Avbruten.', level: 'info' });
    expect(model.summary('s1')).toMatchObject({ status: 'idle', lastError: null });
  });

  it('marks errors and clears everything on exit', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'x' });
    apply({ type: 'error', message: 'krasch' });
    apply({ type: 'exited' });
    expect(model.summary('s1')).toMatchObject({ status: 'error', lastError: 'krasch', activeAgents: 0, resumable: true });
    apply({ type: 'started' });
    expect(model.summary('s1')).toMatchObject({ status: 'idle', lastError: null });
  });
});

describe('questions left for the user', () => {
  const finish = { type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 } as const;

  it('finds questions in an answer, outside code and without list markers', () => {
    const text = ['Klart med steg 1.', '', '1. **Ska jag köra B först?**', '- Vilken port gäller (COM3)?', '```', 'if (x?) y', '```', 'Säg till.'].join('\n');
    expect(findQuestions(text)).toEqual(['Ska jag köra B först?', 'Vilken port gäller (COM3)?']);
  });

  it('waits for the user when the final answer ends with questions, until the next message', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'text', text: 'Är det rätt fil?' }); // an earlier text is not the final answer
    apply({ type: 'text', text: 'Jag har två frågor:\n1. Ska jag byta till rev C7?\n2. Behåller vi 115 200 baud?' });
    apply(finish);
    expect(model.summary('s1')).toMatchObject({ status: 'waiting' });
    expect(model.summary('s1')?.callouts[0]).toMatchObject({ kind: 'question', title: '2 frågor till dig' });
    apply({ type: 'turn_started', prompt: 'ja, och ja' });
    expect(model.summary('s1')?.status).toBe('working');
  });

  it('counts a tagged question and ignores subagent text; dismissing ends the wait', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'text', text: 'Vad gör funktionen?', agentId: 'sub' });
    apply({ type: 'text', text: 'Klart.' });
    apply(finish);
    expect(model.summary('s1')?.status).toBe('done');
    apply({ type: 'turn_started', prompt: 'nästa' });
    apply({ type: 'callout', callout: { kind: 'question', title: '', text: 'Rev C7?' } });
    apply(finish);
    expect(model.summary('s1')?.status).toBe('waiting');
    model.dismissCallouts('s1');
    expect(model.summary('s1')?.status).toBe('done');
  });
});
