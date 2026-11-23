// account: asks Claude Code which plan the user is on and which models (with which effort levels)
// that account may use. The probe sends no message, so it uses no tokens. Availability comes from
// Claude Code itself, not from hard-coded plan rules (e.g. Fable on Max, Ultra and business plans).
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { EFFORT_CHOICES, MODEL_CHOICES } from '../../../shared/contracts';
import type { AccountSnapshot, EffortChoice, ModelChoice, ModelOption } from '../../../shared/contracts';

const FALLBACK_LABEL: Record<ModelChoice, string> = { default: 'Standard', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };

/** Used until the probe answers, or when it cannot: every choice is offered. */
export const UNVERIFIED_ACCOUNT: AccountSnapshot = {
  plan: null,
  verified: false,
  models: MODEL_CHOICES.map((choice) => ({ choice, label: FALLBACK_LABEL[choice], efforts: [...EFFORT_CHOICES] })),
};

export interface ProbeOptions {
  cwd: string;
  pathToClaudeCodeExecutable?: string;
}

export async function probeAccount(options: ProbeOptions): Promise<AccountSnapshot> {
  // A prompt that never yields keeps the process idle: control requests work, no turn is sent.
  async function* noMessages(): AsyncGenerator<never> {
    await new Promise<never>(() => {});
  }
  const q = query({
    prompt: noMessages(),
    options: { cwd: options.cwd, settingSources: [], persistSession: false, pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable },
  });
  try {
    const [info, models] = await Promise.all([q.accountInfo(), q.supportedModels()]);
    return describeAccount(info.subscriptionType ?? null, models);
  } finally {
    q.close();
  }
}

/** Maps Claude Code's model list onto the app's choices. */
export function describeAccount(plan: string | null, models: ModelInfo[]): AccountSnapshot {
  const byValue = new Map(models.map((m) => [m.value, m]));
  const options = MODEL_CHOICES.flatMap((choice): ModelOption[] => {
    const info = byValue.get(choice);
    if (!info) return [];
    const levels = EFFORT_CHOICES.filter((e) => e === 'default' || info.supportedEffortLevels?.includes(e as Exclude<EffortChoice, 'default'>));
    return [{ choice, label: labelFor(choice, info, models), efforts: levels }];
  });
  return options.length ? { plan, verified: true, models: options } : { ...UNVERIFIED_ACCOUNT, plan };
}

/** "Opus 5.5"; the default row becomes "Standard (Opus 5.5)". */
function labelFor(choice: ModelChoice, info: ModelInfo, models: ModelInfo[]): string {
  if (choice !== 'default') return info.displayName;
  const named = models.find((m) => m.value !== 'default' && m.resolvedModel && m.resolvedModel === info.resolvedModel);
  return named ? `Standard (${named.displayName})` : FALLBACK_LABEL.default;
}
