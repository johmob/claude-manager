// Checks whether the built-in "You should know" plugin's notes reach an Agent SDK consumer.
// Usage: node tools/verify-ysk.mjs <workDir> <logFile>
import { query } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, mkdirSync } from 'node:fs';

const [workDir, logFile] = process.argv.slice(2);
if (!workDir || !logFile) throw new Error('usage: verify-ysk.mjs <workDir> <logFile>');
mkdirSync(workDir, { recursive: true });

const task = [
  'Set up a tiny Node project here, step by step, using separate tool calls:',
  '1. Write config.json containing {"dbPassword": "hunter2", "port": 80}.',
  '2. Write server.js that reads config.json and logs the password on startup.',
  '3. Run `node --version` and `node server.js` (it may fail, that is fine).',
  '4. Write a README.md describing the project.',
  'Then summarise what you did in two sentences.',
].join('\n');

const counts = new Map();
const q = query({
  prompt: task,
  options: {
    cwd: workDir,
    model: 'haiku',
    permissionMode: 'acceptEdits',
    allowedTools: ['Bash(node *)', 'Write', 'Read'],
    includeHookEvents: true,
    settings: { enabledPlugins: { 'cc-plugin-you-should-know@builtin': true } },
    env: { ...process.env, CLAUDE_CODE_YOU_SHOULD_KNOW_DEBUG: '1' },
    stderr: (d) => appendFileSync(logFile, JSON.stringify({ stderr: d }) + '\n'),
  },
});

const timer = setTimeout(() => q.close(), 240_000);
let resultSeen = false;
for await (const m of q) {
  appendFileSync(logFile, JSON.stringify(m) + '\n');
  const key = m.type + (m.subtype ? `/${m.subtype}` : '');
  counts.set(key, (counts.get(key) ?? 0) + 1);
  const text = JSON.stringify(m);
  if (/should know|heads.?up/i.test(text) && m.type !== 'assistant') console.log('MATCH', key, text.slice(0, 400));
  if (m.type === 'result') {
    resultSeen = true;
    console.log('result:', String(m.result).slice(0, 200));
    // Give the side agent time to report after the turn.
    setTimeout(() => q.close(), 45_000);
  }
}
clearTimeout(timer);
console.log('result seen:', resultSeen);
for (const [k, v] of counts) console.log(`  ${k} x${v}`);
process.exit(0);
