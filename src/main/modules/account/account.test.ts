import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { describeAccount, UNVERIFIED_ACCOUNT } from './index';

const model = (value: string, displayName: string, resolvedModel: string, levels: ModelInfo['supportedEffortLevels'] = ['low', 'high']): ModelInfo => ({
  value,
  displayName,
  resolvedModel,
  description: '',
  supportedEffortLevels: levels,
});

describe('describeAccount', () => {
  it('offers only the models the account has, with their names and effort levels', () => {
    const account = describeAccount('Claude Pro', [
      model('default', 'Default (recommended)', 'claude-sonnet-5-5'),
      model('sonnet', 'Sonnet 5.5', 'claude-sonnet-5-5', ['low', 'medium', 'high']),
      model('haiku', 'Haiku 5.5', 'claude-haiku-5-5', []),
      model('claude-opus-4-6', 'Opus 4.6', 'claude-opus-4-6'),
    ]);
    expect(account).toEqual({
      plan: 'Claude Pro',
      verified: true,
      models: [
        { choice: 'default', label: 'Standard (Sonnet 5.5)', efforts: ['default', 'low', 'high'] },
        { choice: 'sonnet', label: 'Sonnet 5.5', efforts: ['default', 'low', 'medium', 'high'] },
        { choice: 'haiku', label: 'Haiku 5.5', efforts: ['default'] },
      ],
    });
  });

  it('falls back to every choice when Claude Code lists nothing', () => {
    expect(describeAccount('Claude Max', [])).toEqual({ ...UNVERIFIED_ACCOUNT, plan: 'Claude Max' });
  });
});
