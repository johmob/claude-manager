import { describe, expect, it } from 'vitest';
import type { SessionEvent, SessionRecord, TodoNode, TodoTree } from '../../../shared/contracts';
import { createSessionModel } from './index';

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
  limitResetsAt: null,
};

type EventBody = SessionEvent extends infer E ? (E extends SessionEvent ? Omit<E, 'sessionId'> : never) : never;

function setup() {
  const model = createSessionModel(() => 1000);
  model.upsertRecord(record);
  const apply = (event: EventBody) => model.apply({ ...event, sessionId: 's1' } as SessionEvent);
  /** The turn's tags did not come (or came without anything to add): its end shows as it is. */
  const untagged = (): void => {
    const lastUser = model.transcript('s1').filter((e) => e.kind === 'user').pop();
    model.endTagging('s1', lastUser?.id ?? null);
  };
  return { model, apply, untagged };
}

describe('session-model', () => {
  it('lists the jobs the agent made with CronCreate until deleted, and drops session-only ones when the session ends', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'tool_use', toolUseId: 'a', name: 'CronCreate', summary: '', cron: { kind: 'create', cron: '17 9 * * 1', prompt: 'P', recurring: true, durable: false } });
    apply({ type: 'tool_result', toolUseId: 'a', isError: false, cronJob: { id: 'j1', schedule: 'måndagar', nextFireAt: null } });
    apply({ type: 'tool_use', toolUseId: 'b', name: 'CronCreate', summary: '', cron: { kind: 'create', cron: '43 8 * * *', prompt: 'Q', recurring: true, durable: true } });
    apply({ type: 'tool_result', toolUseId: 'b', isError: false, cronJob: { id: 'j2', schedule: 'dagligen', nextFireAt: null } });
    expect(model.summary('s1')?.sessionCrons.map((j) => j.id)).toEqual(['j1', 'j2']);
    apply({ type: 'tool_use', toolUseId: 'c', name: 'CronDelete', summary: '', cron: { kind: 'delete', id: 'j2' } });
    expect(model.summary('s1')?.sessionCrons.map((j) => j.id)).toEqual(['j1']);
    apply({ type: 'tool_use', toolUseId: 'd', name: 'CronCreate', summary: '', cron: { kind: 'create', cron: '1 1 * * *', prompt: 'R', recurring: true, durable: true } });
    apply({ type: 'tool_result', toolUseId: 'd', isError: false, cronJob: { id: 'j3', schedule: 'natt', nextFireAt: null } });
    apply({ type: 'exited' });
    expect(model.summary('s1')?.sessionCrons.map((j) => j.id)).toEqual(['j3']);
  });

  it('keeps the compact check until the session exits', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    expect(model.summary('s1')?.compactCheck).toBeNull();
    model.setCompactCheck('s1', { state: 'unclear', reason: 'Tvekar' });
    expect(model.summary('s1')?.compactCheck).toEqual({ state: 'unclear', reason: 'Tvekar' });
    apply({ type: 'exited' });
    expect(model.summary('s1')?.compactCheck).toBeNull();
  });

  it('shows compacting with an estimate from the context size, and its result when done', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'context_usage', usage: { percentage: 80, totalTokens: 400000, maxTokens: 500000 } });
    apply({ type: 'compacting', active: true });
    expect(model.summary('s1')).toMatchObject({ status: 'working', currentTask: 'Komprimerar samtalet…', compacting: { startedAt: 1000, preTokens: 400000, expectedMs: 60000 } });
    const shown = apply({ type: 'compacted', preTokens: 400000, postTokens: 38000, durationMs: 72000 });
    expect(shown).toMatchObject([{ kind: 'system', text: 'Konversationen komprimerades: 400k → 38k tokens på 1:12.' }]);
    expect(model.summary('s1')?.compacting).toBeNull();
    apply({ type: 'compacting', active: true });
    expect(model.summary('s1')?.compacting?.expectedMs).toBe(66000);
    expect(apply({ type: 'compacting', active: false, error: 'för stort' })).toMatchObject([{ kind: 'system', level: 'warning' }]);
  });

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
      focus: false,
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

  it('never reads plain text as questions by rules: a report with headings and lists does not wait', () => {
    const { model, apply, untagged } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'text', text: ['Slutkörningen gav 26 av 30 OK. E rättar de fyra som återstår och bygger om:', '', '- Räfflorna slutar nu före huset.', '- Nätfelen är rättade i formen.', '', 'Ska jag fortsätta?'].join('\n') });
    apply(finish);
    untagged();
    expect(model.summary('s1')).toMatchObject({ status: 'done', questions: [], callouts: [] });
  });


  it('counts tagged questions, leaves notes to the tagger, ignores subagent text; dismissing ends the wait', () => {
    const { model, apply, untagged } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'text', text: 'Vad gör funktionen?', agentId: 'sub' });
    apply({ type: 'text', text: 'Klart.' });
    apply(finish);
    untagged();
    expect(model.summary('s1')?.status).toBe('done');
    apply({ type: 'turn_started', prompt: 'nästa' });
    apply({ type: 'callout', callout: { kind: 'question', title: 'Rev', text: 'B eller C?' } });
    apply({ type: 'callout', callout: { kind: 'note', title: '', text: 'Displayen är urkopplad.' } });
    apply(finish);
    untagged();
    // A [!NOTE] is not a question by itself: only the tagger can make it an assumption to confirm.
    expect(model.summary('s1')?.questions).toEqual([{ kind: 'question', text: 'Rev: B eller C?', about: '', detail: '', brief: '', options: [] }]);
    expect(model.summary('s1')?.status).toBe('waiting');
    model.dismissCallouts('s1');
    expect(model.summary('s1')?.status).toBe('done');
  });
});

describe('usage limit', () => {
  const finish = (result = '') => ({ type: 'turn_finished', result, isError: false, interrupted: false, tokens: 0, durationMs: 0 }) as const;

  it('stays limited after the turn ends, until a new turn starts', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'rate_limit', windows: { fiveHour: null, sevenDay: null }, rejected: true, resetsAt: '2026-11-23T17:30:00.000Z' });
    apply(finish());
    expect(model.summary('s1')).toMatchObject({ status: 'limited', limitResetsAt: '2026-11-23T17:30:00.000Z', lastError: expect.stringMatching(/^Användningsgränsen är nådd\. Den återställs .*kl \d\d:30\.$/) });
    apply({ type: 'turn_started', prompt: 'fortsätt' });
    expect(model.summary('s1')).toMatchObject({ status: 'working', limitResetsAt: null });
  });

  it('recognises a turn refused by the limit from its result text', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply(finish('Claude AI usage limit reached|1795437000'));
    expect(model.summary('s1')).toMatchObject({ status: 'limited', limitResetsAt: '' });
  });
});

describe('open questions across turns', () => {
  it('keeps them through a later turn without questions that the user did not start', () => {
    const { model, apply, untagged } = setup();
    const finish = { type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 } as const;
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'callout', callout: { kind: 'question', title: '', text: 'Ska jag fortsätta?' } });
    apply(finish);
    // A subagent finishes and the agent writes again on its own.
    apply({ type: 'text', text: 'Subagenten är klar.' });
    apply(finish);
    untagged();
    expect(model.summary('s1')?.questions.map((q) => q.text)).toEqual(['Ska jag fortsätta?']);
    expect(model.summary('s1')?.status).toBe('waiting');
  });
});

describe('questions already answered', () => {
  it('does not ask again what the user replied to, even when the agent lists it anew', () => {
    const { model, apply } = setup();
    const finish = { type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 } as const;
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'callout', callout: { kind: 'question', title: '', text: 'Ska jag använda SPI-bussen för givaren?' } });
    apply(finish);
    apply({ type: 'turn_started', prompt: 'Svar: ja' });
    apply({ type: 'text', text: 'Öppna frågor: SPI (besvarad), baudrate.' });
    apply(finish);
    const lastUser = model.transcript('s1').filter((e) => e.kind === 'user').pop()!;
    model.applyTurnTags('s1', lastUser.id, [{ kind: 'question', text: 'Ska jag använda SPI-bussen för givaren? (besvarad)', about: '', detail: '', brief: '', options: [] }, { kind: 'question', text: 'Vilken baudrate ska gälla', about: '', detail: '', brief: '', options: [] }], []);
    expect(model.summary('s1')?.questions.map((q) => q.text)).toEqual(['Vilken baudrate ska gälla']);
  });
});

describe('usage limit after a restart', () => {
  it('a saved limit makes a session that is not running limited again', () => {
    const { model } = setup();
    model.setLimit('s1', '2026-11-23T17:30:00.000Z');
    expect(model.summary('s1')).toMatchObject({ status: 'limited', limitResetsAt: '2026-11-23T17:30:00.000Z' });
  });
});

describe('turn tags from a cheap model', () => {
  it('keeps the questions of a turn when the user writes again before its tags come', () => {
    const { model, apply } = setup();
    const finish = { type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 } as const;
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'planera webben' });
    apply({ type: 'text', text: 'Planen är klar.' });
    apply({ type: 'callout', callout: { kind: 'question', title: 'web.an', text: 'Ska analysen eller grundpaketet göras först?' } });
    apply(finish);
    const asked = model.transcript('s1').filter((e) => e.kind === 'user').pop()!;
    apply({ type: 'turn_started', prompt: 'lägg filerna i en mapp' });
    model.applyTurnTags('s1', asked.id, [{ kind: 'question', text: 'Ska analysen eller grundpaketet göras först?', about: 'web.an', detail: '', brief: '', options: [] }], []);
    expect(model.summary('s1')?.questions.map((q) => q.text)).toEqual(['Ska analysen eller grundpaketet göras först?']);
  });

  it('add the questions the model found, keep the agent own tagged ones, and tag the blocks', () => {
    const { model, apply } = setup();
    const finish = { type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 } as const;
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'text', text: 'E väntar på ditt val mellan 1 och 1b.' });
    apply({ type: 'callout', callout: { kind: 'question', title: '', text: 'Får jag beställa kortet?' } });
    apply({ type: 'text', text: 'Medan E väntar gör den SD-ändringen.' });
    apply(finish);
    const transcript = model.transcript('s1');
    const lastUser = transcript.filter((e) => e.kind === 'user').pop()!;
    const choice = transcript.find((e) => e.kind === 'assistant' && e.text.startsWith('E väntar'))!;
    const changed = model.applyTurnTags('s1', lastUser.id, [{ kind: 'question', text: 'Greppet: 1 eller 1b?', about: '', detail: '', brief: 'Två varianter.', options: ['1', '1b'] }], [{ entryId: choice.id, blocks: [{ text: 'E väntar på ditt val mellan 1 och 1b.', tag: 'question' }] }]);
    expect(changed.map((e) => e.id)).toContain(choice.id);
    expect(model.transcript('s1').find((e) => e.id === choice.id)).toMatchObject({ blocks: [{ tag: 'question' }] });
    // The agent's own callout question went to the tagger too; the tagger's list stands.
    expect(model.summary('s1')?.questions.map((q) => q.text)).toEqual(['Greppet: 1 eller 1b?']);
    expect(model.summary('s1')?.status).toBe('waiting');
  });
});

describe('questions after a restart', () => {
  it('saved open questions make a session that is not running wait again', () => {
    const { model } = setup();
    const q = { kind: 'question' as const, text: 'cad.1 Kåpan: M3 eller M4?', about: 'cad.1 Kåpan', detail: '', brief: '', options: ['M3', 'M4'] };
    model.setQuestions('s1', { id: '42', answer: 'Svaret.', questions: [q] });
    expect(model.summary('s1')).toMatchObject({ status: 'waiting', questionsId: '42', questionsAnswer: 'Svaret.', questions: [q] });
  });
});

describe('question queue within a chat', () => {
  it('new questions from a turn the user did not start queue up after the open ones', () => {
    const { model, apply } = setup();
    const finish = { type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 } as const;
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'callout', callout: { kind: 'question', title: '', text: 'M3 eller M4?' } });
    apply(finish);
    const first = model.summary('s1')!.questionsId;
    // A subagent finishes and the agent asks again, before the user has replied.
    apply({ type: 'callout', callout: { kind: 'question', title: '', text: 'Fyra eller sex skruvar?' } });
    apply(finish);
    expect(model.summary('s1')?.questions.map((q) => q.text)).toEqual(['M3 eller M4?', 'Fyra eller sex skruvar?']);
    expect(model.summary('s1')?.questionsId).not.toBe(first);
    // The cheap model's tags for that turn keep the earlier question first.
    const lastUser = model.transcript('s1').filter((e) => e.kind === 'user').pop()!;
    // The tagger lists this turn's questions, the agent's own callout question included.
    model.applyTurnTags('s1', lastUser.id, [{ kind: 'question', text: 'Fyra eller sex skruvar?', about: '', detail: '', brief: '', options: [] }, { kind: 'question', text: 'Ska kåpan vara svart?', about: '', detail: '', brief: '', options: [] }], []);
    expect(model.summary('s1')?.questions.map((q) => q.text)).toEqual(['M3 eller M4?', 'Fyra eller sex skruvar?', 'Ska kåpan vara svart?']);
  });
});

describe('a turn\'s end waits for its tags', () => {
  it('holds the text, the questions and the done status until the tags are in, then shows them at once', () => {
    const { model, apply } = setup();
    const finish = { type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 } as const;
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'text', text: 'Klart. M3 eller M4?' });
    apply({ type: 'callout', callout: { kind: 'question', title: '', text: 'M3 eller M4?' } });
    apply(finish);
    const answer = model.transcript('s1').find((e) => e.kind === 'assistant')!;
    expect(answer).toMatchObject({ held: true });
    expect(model.summary('s1')).toMatchObject({ status: 'working', questions: [], currentTask: 'Läser igenom svaret…' });
    const lastUser = model.transcript('s1').filter((e) => e.kind === 'user').pop()!;
    const changed = model.applyTurnTags('s1', lastUser.id, [{ kind: 'question', text: 'M3 eller M4?', about: '', detail: '', brief: '', options: [] }], [{ entryId: answer.id, blocks: [{ text: 'Klart. M3 eller M4?', tag: 'question' }] }]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ blocks: [{ tag: 'question' }] });
    expect(changed[0]).not.toHaveProperty('held');
    expect(model.summary('s1')).toMatchObject({ status: 'waiting', questions: [{ text: 'M3 eller M4?' }] });
  });

  it('shows the held text as it is when a new message comes first', () => {
    const { model, apply } = setup();
    const finish = { type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 } as const;
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'text', text: 'Klart.' });
    apply(finish);
    apply({ type: 'turn_started', prompt: 'mer' });
    expect(model.transcript('s1').find((e) => e.kind === 'assistant')).not.toHaveProperty('held');
  });

  it('does not restyle text already shown when its tags arrive late', () => {
    const { model, apply } = setup();
    const finish = { type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 } as const;
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'text', text: 'Klart.' });
    apply(finish);
    const firstUser = model.transcript('s1').filter((e) => e.kind === 'user').pop()!;
    const answer = model.transcript('s1').find((e) => e.kind === 'assistant')!;
    apply({ type: 'turn_started', prompt: 'mer' });
    const changed = model.applyTurnTags('s1', firstUser.id, [], [{ entryId: answer.id, blocks: [{ text: 'Klart.', tag: 'answer' }] }]);
    expect(changed).toEqual([]);
    expect(model.transcript('s1').find((e) => e.id === answer.id)).not.toHaveProperty('blocks');
  });
});

describe('a message sent while the agent is busy', () => {
  it('is marked as not read until the running turn ends', () => {
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'bygg' });
    apply({ type: 'text', text: 'Bygger…' });
    apply({ type: 'turn_started', prompt: 'glöm inte testerna' });
    const queued = model.transcript('s1').filter((e) => e.kind === 'user').pop()!;
    expect(queued).toMatchObject({ queued: true });
    const changed = model.apply({ type: 'turn_finished', sessionId: 's1', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 });
    expect(changed.find((e) => e.id === queued.id)).not.toHaveProperty('queued');
    expect(model.transcript('s1').filter((e) => e.kind === 'user')[0]).not.toHaveProperty('queued');
  });
});

describe('text the app adds for the agent only', () => {
  it('is left out of the chat; a message the app wrote alone shows as a note', async () => {
    const { appContext } = await import('../../../shared/contracts');
    const { model, apply } = setup();
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: `${appContext('Ändringar följde med', '2 nya commits')}\n\nFixa knappen` });
    expect(model.transcript('s1').pop()).toMatchObject({ kind: 'user', text: 'Fixa knappen' });
    apply({ type: 'turn_started', prompt: appContext('Appen bad agenten uppdatera schemat', 'Uppdatera arbetsschemat.') });
    expect(model.transcript('s1').pop()).toMatchObject({ kind: 'system', text: 'Appen bad agenten uppdatera schemat', level: 'info' });
    expect(model.summary('s1')?.status).toBe('working');
  });
});

describe('questions all skipped', () => {
  it('close without a message, and the same question is not asked again', () => {
    const { model, apply, untagged } = setup();
    const finish = { type: 'turn_finished', result: '', isError: false, interrupted: false, tokens: 0, durationMs: 0 } as const;
    apply({ type: 'started' });
    apply({ type: 'turn_started', prompt: 'kör' });
    apply({ type: 'callout', callout: { kind: 'question', title: '', text: 'Ska jag starta om appen åt dig?' } });
    apply(finish);
    untagged();
    expect(model.summary('s1')?.questions).toHaveLength(1);
    model.dismissCallouts('s1');
    expect(model.summary('s1')?.questions).toEqual([]);
    const lastUser = model.transcript('s1').filter((e) => e.kind === 'user').pop()!;
    model.applyTurnTags('s1', lastUser.id, [{ kind: 'question', text: 'Ska jag starta om appen åt dig?', about: '', detail: '', brief: '', options: [] }], []);
    expect(model.summary('s1')?.questions).toEqual([]);
  });
});
