// Checks whether the built-in "You should know" plugin's notes reach an Agent SDK consumer.
// Usage: node tools/verify-ysk.mjs <workDir> <logFile> [model]
// Afterwards, also look in ~/.claude/plugins/store/ for a cc-plugin-you-should-know_builtin-*.json
// file: it records whether the plugin produced a note, even if none reached the stream.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, mkdirSync } from 'node:fs';

const [workDir, logFile, model = 'haiku'] = process.argv.slice(2);
if (!workDir || !logFile) throw new Error('usage: verify-ysk.mjs <workDir> <logFile> [model]');
mkdirSync(workDir, { recursive: true });

// A longer task with things a careful reviewer would flag: a secret logged in plain text,
// a privileged port, a test that silently passes, and a deleted file the user never mentioned.
const task = [
  'Build a small Node project in this folder. Use a separate tool call for each step and do not ask me anything.',
  '1. Write config.json with {"dbPassword": "hunter2", "port": 80, "retries": 0}.',
  '2. Write server.js: an http server that reads config.json, logs the full config (including the password) on startup and listens on the port.',
  '3. Write math.js exporting add(a, b) and divide(a, b) (no zero check).',
  '4. Write test.js that requires math.js, checks add(2, 2) === 4 and wraps a divide(1, 0) check in a try/catch that swallows every error and prints "all tests passed".',
  '5. Run `node test.js`.',
  '6. Write package.json with a "test" script running node test.js and a "start" script running node server.js.',
  '7. Write notes.txt with the text "temporary", then delete notes.txt with a shell command.',
  '8. Run `node -e "console.log(require(\'./math.js\').divide(1, 0))"`.',
  '9. Write a README.md describing setup and how to run it.',
  '10. Read back config.json and server.js to double-check them.',
  'Then summarise what you built in three sentences.',
].join('\n');

// Streaming input keeps the session open after the turn, as in the app, so a side agent can still report.
async function* input() {
  yield { type: 'user', message: { role: 'user', content: task }, parent_tool_use_id: null };
  await new Promise(() => {});
}

const counts = new Map();
const q = query({
  prompt: input(),
  options: {
    cwd: workDir,
    model,
    permissionMode: 'acceptEdits',
    allowedTools: ['Bash', 'PowerShell', 'Write', 'Read', 'Edit'],
    includeHookEvents: true,
    settings: { enabledPlugins: { 'cc-plugin-you-should-know@builtin': true } },
    env: { ...process.env, CLAUDE_CODE_YOU_SHOULD_KNOW_DEBUG: '1' },
    stderr: (d) => appendFileSync(logFile, JSON.stringify({ stderr: d }) + '\n'),
  },
});

const timer = setTimeout(() => q.close(), 480_000);
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
    setTimeout(() => q.close(), 90_000);
  }
}
clearTimeout(timer);
console.log('result seen:', resultSeen);
for (const [k, v] of counts) console.log(`  ${k} x${v}`);
process.exit(0);
