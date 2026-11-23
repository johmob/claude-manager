import { USAGE_CRIT_PCT, USAGE_NOTICE_PCT, USAGE_WARN_PCT, type UsageSnapshot, type UsageWindow } from '../../../shared/contracts';
import { formatReset } from '../lib/format';
import { send } from '../lib/api';

/** Green below 50 % used, yellow from 50 %, orange from 70 %, red from 90 %. */
function level(utilization: number): 'ok' | 'notice' | 'warn' | 'crit' {
  if (utilization >= USAGE_CRIT_PCT) return 'crit';
  if (utilization >= USAGE_WARN_PCT) return 'warn';
  if (utilization >= USAGE_NOTICE_PCT) return 'notice';
  return 'ok';
}

function UsageBar(props: { label: string; window: UsageWindow | null; weekday: boolean }) {
  const { label, window: w, weekday } = props;
  if (!w) {
    return (
      <div className="usage-row">
        <div className="usage-label">{label}</div>
        <div className="usage-none">Ingen data</div>
      </div>
    );
  }
  const used = Math.min(100, Math.max(0, w.utilization));
  const remaining = Math.round(100 - used);
  const reset = formatReset(w.resetsAt, weekday);
  return (
    <div className="usage-row" data-level={level(used)}>
      <div className="usage-label">
        <span>{label}</span>
        <span className="usage-remaining">{remaining} % kvar</span>
      </div>
      <div className="usage-bar" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
        <div className="usage-fill" style={{ width: `${used}%` }} />
      </div>
      {reset && <div className="usage-reset">{reset}</div>}
    </div>
  );
}

export function UsagePanel({ usage }: { usage: UsageSnapshot }) {
  return (
    <aside className="usage-panel">
      <div className="usage-title">
        <span>Användning</span>
        <button type="button" className="icon-btn" title="Uppdatera" aria-label="Uppdatera" onClick={() => send('usage:refresh', undefined)}>
          ↻
        </button>
      </div>
      <UsageBar label="5 timmar" window={usage.fiveHour} weekday={false} />
      <UsageBar label="Vecka" window={usage.sevenDay} weekday />
      {usage.error && <div className="usage-error">{usage.error}</div>}
    </aside>
  );
}
