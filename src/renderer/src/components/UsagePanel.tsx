import type { UsageSnapshot, UsageWindow } from '../../../shared/contracts';
import { formatReset } from '../lib/format';
import { send } from '../lib/api';
import { useAccount } from '../state/account';
import { usageLevel } from '../lib/usage';

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
  const reset = formatReset(w.resetsAt, weekday);
  return (
    <div className="usage-row" data-level={usageLevel(used)}>
      <div className="usage-label">
        <span>{label}</span>
        <span className="usage-used">{Math.round(used)} % använt</span>
      </div>
      <div className="usage-bar" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
        <div className="usage-fill" style={{ width: `${used}%` }} />
      </div>
      {reset && <div className="usage-reset">{reset}</div>}
    </div>
  );
}

export function UsagePanel({ usage }: { usage: UsageSnapshot }) {
  const plan = useAccount()?.plan;
  return (
    <aside className="usage-panel">
      <div className="usage-title">
        <span>
          Användning
          {plan && <span className="usage-plan">{plan}</span>}
        </span>
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
