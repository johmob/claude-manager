// structured-query: one stateless Claude call through the Agent SDK (on the user's Claude Code login)
// whose answer must match a JSON schema. Nothing is saved to Claude Code's session history.
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { StructuredQuery } from '../../../shared/contracts';

export const structuredQuery: StructuredQuery = async (request) => {
  const run = query({
    prompt: request.prompt,
    options: {
      cwd: request.cwd,
      model: request.model === 'default' ? undefined : request.model,
      tools: request.tools,
      permissionMode: 'dontAsk',
      settingSources: [],
      persistSession: false,
      maxTurns: request.maxTurns,
      outputFormat: { type: 'json_schema', schema: request.schema },
    },
  });
  for await (const message of run) {
    if (message.type === 'result') return message.subtype === 'success' ? (message.structured_output ?? null) : null;
  }
  return null;
};
