// heads-up ("Bra att veta"): after a turn with real work, one stateless Haiku review of that turn
// flags at most one thing the user should know but would likely miss from the final answer.
import type { HeadsUpNote, StructuredQuery, TranscriptEntry } from '../../../shared/contracts';
import { isRecord } from '../../../shared/guards';

/** Turns with fewer tool calls are plain answers and are not reviewed. */
export const MIN_TOOL_CALLS = 3;
const MAX_DIGEST_CHARS = 8000;
const HEAD_CHARS = 1500;

export interface TurnDigest {
  text: string;
  toolCalls: number;
}

const SCHEMA = {
  type: 'object',
  properties: {
    worthKnowing: { type: 'boolean' },
    title: { type: 'string' },
    text: { type: 'string' },
  },
  required: ['worthKnowing', 'title', 'text'],
  additionalProperties: false,
};

/** The latest turn (from the last user message on) as a compact log. */
export function digestTurn(entries: TranscriptEntry[]): TurnDigest {
  const start = entries.map((e) => e.kind).lastIndexOf('user');
  const turn = start < 0 ? entries : entries.slice(start);
  const text = turn.map(logLine).filter(Boolean).join('\n');
  return { text: shorten(text), toolCalls: turn.filter((e) => e.kind === 'tool').length };
}

export async function reviewTurn(digest: TurnDigest, ask: StructuredQuery, cwd: string): Promise<HeadsUpNote | null> {
  if (digest.toolCalls < MIN_TOOL_CALLS) return null;
  const answer = await ask({ prompt: reviewPrompt(digest.text), schema: SCHEMA, model: 'haiku', cwd, tools: [], maxTurns: 3 });
  if (!isRecord(answer) || answer['worthKnowing'] !== true) return null;
  const title = String(answer['title'] ?? '').trim();
  const text = String(answer['text'] ?? '').trim();
  return title && text ? { title, text } : null;
}

function logLine(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case 'user':
      return `USER: ${entry.text}`;
    case 'assistant':
      return entry.text ? `AGENT${entry.agentId ? ' (subagent)' : ''}: ${entry.text}` : '';
    case 'tool':
      return `TOOL ${entry.name} [${entry.status}]${entry.summary ? `: ${entry.summary}` : ''}`;
    case 'question':
      return `QUESTION TO USER: ${entry.text} -> ${entry.answer ?? 'unanswered'}`;
    case 'system':
      return `SYSTEM (${entry.level}): ${entry.text}`;
  }
}

/** Keeps the request and the end of the turn (where the outcome is) when the log is long. */
function shorten(text: string): string {
  if (text.length <= MAX_DIGEST_CHARS) return text;
  const tail = MAX_DIGEST_CHARS - HEAD_CHARS;
  return `${text.slice(0, HEAD_CHARS)}\n[… middle of the turn left out …]\n${text.slice(-tail)}`;
}

function reviewPrompt(log: string): string {
  return `You are a second pair of eyes for a developer who supervises several Claude Code sessions at once and only skims each session's final answer.

Below is the log of one finished turn of one session. Decide whether there is ONE thing the developer should know but would likely miss if they only read the agent's final answer. Typical examples:
- a password, key or other secret written to a file or logged in plain text
- a destructive or irreversible action (deleted files, force push, dropped data, overwritten work)
- tests or checks that did not really run, or that hide failures
- errors or failed tool calls that the final answer glosses over
- changes outside what was asked, or a risky assumption the agent made silently

If the final answer already states it plainly, or nothing important stands out, set worthKnowing to false.
Otherwise set worthKnowing to true and write, in Swedish, a concrete title (at most 8 words) and text (at most 2 sentences) that name the file or command involved.

<turn_log>
${log}
</turn_log>`;
}
