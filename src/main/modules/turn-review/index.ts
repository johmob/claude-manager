// turn-review: optional, independent second opinion. After a turn with real work, one stateless
// Haiku call reviews only that turn's log and returns at most one callout the user might miss.
// The working agent tags callouts itself (session-engine CALLOUT_PROTOCOL); this catches what it
// does not see in its own work.
import { CALLOUT_KINDS } from '../../../shared/contracts';
import type { Callout, CalloutKind, StructuredQuery, TranscriptEntry } from '../../../shared/contracts';
import { isRecord } from '../../../shared/guards';

/** Turns with fewer tool calls are plain answers and are not reviewed. */
export const MIN_TOOL_CALLS = 3;
const MAX_DIGEST_CHARS = 8000;
const HEAD_CHARS = 1500;
const REVIEW_KINDS: readonly CalloutKind[] = CALLOUT_KINDS.filter((k) => k !== 'tip');

export interface TurnDigest {
  text: string;
  toolCalls: number;
}

const SCHEMA = {
  type: 'object',
  properties: {
    worthKnowing: { type: 'boolean' },
    kind: { type: 'string', enum: REVIEW_KINDS },
    title: { type: 'string' },
    text: { type: 'string' },
  },
  required: ['worthKnowing', 'kind', 'title', 'text'],
  additionalProperties: false,
};

/** The latest turn (from the last user message on) as a compact log. */
export function digestTurn(entries: TranscriptEntry[]): TurnDigest {
  const start = entries.map((e) => e.kind).lastIndexOf('user');
  const turn = start < 0 ? entries : entries.slice(start);
  const text = turn.map(logLine).filter(Boolean).join('\n');
  return { text: shorten(text), toolCalls: turn.filter((e) => e.kind === 'tool').length };
}

export async function reviewTurn(digest: TurnDigest, ask: StructuredQuery, cwd: string): Promise<Callout | null> {
  if (digest.toolCalls < MIN_TOOL_CALLS) return null;
  const answer = await ask({ prompt: reviewPrompt(digest.text), schema: SCHEMA, model: 'haiku', cwd, tools: [], maxTurns: 3 });
  if (!isRecord(answer) || answer['worthKnowing'] !== true) return null;
  const kind = REVIEW_KINDS.find((k) => k === answer['kind']) ?? 'important';
  const title = String(answer['title'] ?? '').trim();
  const text = String(answer['text'] ?? '').trim();
  return title && text ? { kind, title, text, source: 'review' } : null;
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
    case 'callout':
      return `AGENT FLAGGED (${entry.callout.kind}): ${entry.callout.title} ${entry.callout.text}`;
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

Below is the log of one finished turn of one session. Decide whether there is ONE thing the developer should know but would likely miss if they only read the agent's final answer and the items the agent already flagged. Typical examples:
- a password, key or other secret written to a file or logged in plain text
- a destructive or irreversible action (deleted files, force push, dropped data, overwritten work)
- tests or checks that did not really run, or that hide failures
- errors or failed tool calls that the final answer glosses over
- changes outside what was asked, or a risky assumption the agent made silently

If the agent already flagged it or stated it plainly, or nothing important stands out, set worthKnowing to false.
Otherwise set worthKnowing to true, choose kind (caution: risky or irreversible, security; warning: something failed or was skipped; important: easy to miss; note: an assumption), and write, in Swedish, a concrete title (at most 8 words) and text (at most 2 sentences) that name the file or command involved.

<turn_log>
${log}
</turn_log>`;
}
