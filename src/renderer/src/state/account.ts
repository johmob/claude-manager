import { createContext, useContext } from 'react';
import { EFFORT_CHOICES } from '../../../shared/contracts';
import type { AccountSnapshot, EffortChoice, ModelChoice, ModelOption } from '../../../shared/contracts';

/** The account's plan and models, provided once by the main window. */
export const AccountContext = createContext<AccountSnapshot | null>(null);

export function useAccount(): AccountSnapshot | null {
  return useContext(AccountContext);
}

/** The account's models, plus `current` (marked unavailable) when the account no longer offers it. */
export function modelOptions(account: AccountSnapshot | null, current?: ModelChoice): ModelOption[] {
  const models = account?.models ?? [];
  if (!current || models.some((m) => m.choice === current)) return models;
  return [...models, { choice: current, label: `${current} (ej tillgänglig)`, efforts: [...EFFORT_CHOICES] }];
}

/** Effort levels the chosen model supports, plus `current` if it is not among them. */
export function effortOptions(models: ModelOption[], model: ModelChoice, current?: EffortChoice): EffortChoice[] {
  const levels = models.find((m) => m.choice === model)?.efforts ?? [...EFFORT_CHOICES];
  return current && !levels.includes(current) ? [...levels, current] : levels;
}
