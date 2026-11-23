import { USAGE_CRIT_PCT, USAGE_NOTICE_PCT, USAGE_WARN_PCT } from '../../../shared/contracts';

export type UsageLevel = 'ok' | 'notice' | 'warn' | 'crit';

/** Green below 50 % used, yellow from 50 %, orange from 70 %, red from 90 %. */
export function usageLevel(utilization: number): UsageLevel {
  if (utilization >= USAGE_CRIT_PCT) return 'crit';
  if (utilization >= USAGE_WARN_PCT) return 'warn';
  if (utilization >= USAGE_NOTICE_PCT) return 'notice';
  return 'ok';
}
