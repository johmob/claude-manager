// structured-query: one stateless Claude call through the Agent SDK (on the user's Claude Code login)
// whose answer must match a JSON schema. Nothing is saved to Claude Code's session history.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { tokenUsageOf, type StructuredQuery, type TokenUsage } from '../../../shared/contracts';

export interface StructuredQueryOptions {
  /** Claude Code executable to run; needed in the installed app, where the SDK cannot find its own. */
  pathToClaudeCodeExecutable?: string;
  /** Told what each call used, and on which model. */
  onUsage?: (usage: TokenUsage, model: string) => void;
}

export function createStructuredQuery(options: StructuredQueryOptions = {}): StructuredQuery {
  return async (request) => {
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
        // Untrusted input (mail): no MCP server of any kind, so no connector can be reached from inside the text.
        ...(request.isolated ? { strictMcpConfig: true, settings: { disableClaudeAiConnectors: true } } : {}),
        outputFormat: { type: 'json_schema', schema: request.schema },
        pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
      },
    });
    for await (const message of run) {
      if (message.type !== 'result') continue;
      options.onUsage?.(tokenUsageOf(message.usage), request.model);
      return message.subtype === 'success' ? (message.structured_output ?? null) : null;
    }
    return null;
  };
}
