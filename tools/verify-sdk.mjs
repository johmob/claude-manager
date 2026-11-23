// Verifies which Claude Code features work through the Agent SDK in streaming-input mode.
// Usage: node tools/verify-sdk.mjs <workDir> <logFile>
// Runs a short scripted conversation on a cheap model and prints a summary of what arrived.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, mkdirSync } from 'node:fs';

const [workDir, logFile] = process.argv.slice(2);
if (!workDir || !logFile) throw new Error('usage: verify-sdk.mjs <workDir> <logFile>');
mkdirSync(workDir, { recursive: true });

const steps = [
  'Use the AskUserQuestion tool to ask me whether I prefer red or blue. After I answer, reply with only the colour I chose.',
  'Run this exact shell command with the Bash tool: echo spike > spike.txt . Then reply with only the word done.',
  'Use the TodoWrite tool to create a todo list with two items: "Plan" (completed) and "Build" (in_progress). Then reply with only ok.',
  '/context',
  '/compact',
  '/clear',
  'Reply with only the word alive.',
];

const pending = [];
let wake = null;
const push = (text) => {
  pending.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
  wake?.();
};
async function* input() {
  while (true) {
    while (pending.length) yield pending.shift();
    await new Promise((r) => (wake = r));
  }
}

const seen = new Map();
const findings = [];
const note = (k, v) => findings.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
const log = (obj) => appendFileSync(logFile, JSON.stringify(obj) + '\n');

const q = query({
  prompt: input(),
  options: {
    cwd: workDir,
    model: 'claude-haiku-5-5',
    permissionMode: 'default',
    thinking: { type: 'adaptive', display: 'summarized' },
    includePartialMessages: false,
    agentProgressSummaries: true,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Base ground rules appended by Claude Manager.' },
    canUseTool: async (toolName, toolInput, opts) => {
      log({ canUseTool: toolName, toolInput, title: opts.title, displayName: opts.displayName });
      note(`canUseTool(${toolName})`, opts.title ?? '(no title)');
      if (toolName === 'AskUserQuestion') {
        const answers = Object.fromEntries(toolInput.questions.map((qq) => [qq.question, qq.options[1].label]));
        return { behavior: 'allow', updatedInput: { ...toolInput, answers } };
      }
      return { behavior: 'allow', updatedInput: toolInput };
    },
  },
});

const timer = setTimeout(() => {
  note('TIMEOUT', 'aborted after 240 s');
  q.close();
}, 240_000);

let step = 0;
push(steps[step]);
try {
  for await (const m of q) {
    log(m);
    const key = m.type + (m.subtype ? `/${m.subtype}` : '');
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (m.type === 'system' && m.subtype === 'init' && seen.get(key) === 1) {
      note('init.model', m.model);
      note('init.permissionMode', m.permissionMode);
      note('init.slash_commands', m.slash_commands);
      note('init.plugins', m.plugins.map((p) => p.name));
      note('init.capabilities', m.capabilities ?? []);
      q.supportedCommands().then((c) => note('supportedCommands', c.map((x) => x.name)));
      q.supportedModels().then((ms) => note('supportedModels', ms.map((x) => x.value ?? x.id ?? x)));
      q.getContextUsage().then((u) => note('getContextUsage.keys', Object.keys(u)), (e) => note('getContextUsage.error', String(e)));
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
        .then((u) => note('usage_EXPERIMENTAL', u), (e) => note('usage_EXPERIMENTAL.error', String(e)));
    }
    if (m.type === 'assistant') {
      for (const b of m.message.content) {
        if (b.type === 'thinking') note(`step${step}.thinking`, (b.thinking ?? '').slice(0, 80) || '(empty)');
        if (b.type === 'text') note(`step${step}.text`, b.text.slice(0, 160));
        if (b.type === 'tool_use') note(`step${step}.tool_use`, b.name);
      }
    }
    if (m.type === 'system' && m.subtype === 'local_command_output') note(`step${step}.local_command_output`, m.content.slice(0, 300));
    if (m.type === 'system' && m.subtype === 'session_state_changed') note(`step${step}.state`, m.state);
    if (m.type === 'system' && m.subtype === 'compact_boundary') note(`step${step}.compact_boundary`, 'yes');
    if (m.type === 'conversation_reset') note(`step${step}.conversation_reset`, m.trigger ?? '');
    if (m.type === 'rate_limit_event') note('rate_limit_event', m.rate_limit_info);
    if (m.type === 'result') {
      note(`step${step}.result`, { subtype: m.subtype, result: String(m.result ?? '').slice(0, 160), cost: m.total_cost_usd });
      step += 1;
      if (step < steps.length) push(steps[step]);
      else break;
    }
  }
} catch (e) {
  note('ERROR', String(e?.stack ?? e));
} finally {
  clearTimeout(timer);
  q.close();
}
await new Promise((r) => setTimeout(r, 500));
console.log('== message types seen');
for (const [k, v] of seen) console.log(`  ${k} x${v}`);
console.log('== findings');
for (const f of findings) console.log('  ' + f);
process.exit(0);
