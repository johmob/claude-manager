import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { SessionSummary, UsageSnapshot, UsageWindow } from '../../../shared/contracts';
import { SessionInfo } from '../components/SessionInfo';
import { send } from '../lib/api';
import { formatReset, monogram } from '../lib/format';
import { usageLevel } from '../lib/usage';
import { useAppState } from '../state/useAppState';

const MAX_NAME = 7;

function shortName(name: string): string {
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}

/** Small mark on the icon for states that need a glance: waiting, done, error. */
const STATUS_MARK: Partial<Record<SessionSummary['status'], string>> = { waiting: '!', done: '✓', error: '×' };

function UsageRow({ label, window: w }: { label: string; window: UsageWindow | null }) {
  const used = w ? Math.round(Math.min(100, Math.max(0, w.utilization))) : null;
  return (
    <span className="ov-usage-row" data-level={used === null ? 'ok' : usageLevel(used)}>
      <span className="ov-usage-label">{label}</span>
      <span className="ov-usage-bar"><span style={{ width: `${used ?? 0}%` }} /></span>
      <span className="ov-usage-pct">{used === null ? '–' : `${used}%`}</span>
    </span>
  );
}

function UsageDetail({ usage }: { usage: UsageSnapshot }) {
  const line = (label: string, w: UsageWindow | null, weekday: boolean): string =>
    w ? `${label}: ${Math.round(w.utilization)} % använt${formatReset(w.resetsAt, weekday) ? ` · ${formatReset(w.resetsAt, weekday)}` : ''}` : `${label}: ingen data`;
  return (
    <div className="session-info">
      <div className="si-head"><strong>Användning</strong></div>
      <div>{line('5 timmar', usage.fiveHour, false)}</div>
      <div>{line('Vecka', usage.sevenDay, true)}</div>
    </div>
  );
}

/**
 * Click-through strip at the top of the screen: usage first, then one icon per session with its
 * status and number of active agents. Hovering shows details below; Ctrl+click opens the session.
 */
export function OverlayWindow() {
  const state = useAppState();
  const interactive = useRef(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const setInteractive = (value: boolean): void => {
    if (interactive.current === value) return;
    interactive.current = value;
    send('overlay:set-interactive', { interactive: value });
  };

  // The window grows downwards while details are shown, and shrinks back afterwards.
  const detailOpen = hovered !== null;
  useEffect(() => send('overlay:set-detail', { open: detailOpen }), [detailOpen]);

  if (!state) return null;
  const session = state.sessions.find((s) => s.id === hovered) ?? null;

  return (
    <div
      className="overlay"
      onMouseMove={(e: MouseEvent) => setInteractive(e.ctrlKey)}
      onMouseLeave={() => {
        setInteractive(false);
        setHovered(null);
      }}
    >
      <div className="ov-row">
        <div className="ov-usage" onMouseEnter={() => setHovered('usage')}>
          <UsageRow label="5h" window={state.usage.fiveHour} />
          <UsageRow label="V" window={state.usage.sevenDay} />
        </div>
        {state.sessions.map((s) => (
          <div
            key={s.id}
            className="ov-cell"
            data-status={s.status}
            style={{ '--accent': s.color } as CSSProperties}
            onMouseEnter={() => setHovered(s.id)}
            onClick={() => send('window:show-session', { id: s.id })}
          >
            <span className="ov-icon">
              <span className="ov-ring" />
              <span className="ov-letters">{monogram(s.name)}</span>
              {STATUS_MARK[s.status] && <span className="ov-mark">{STATUS_MARK[s.status]}</span>}
              {s.activeAgents > 0 && <span className="ov-agents" title="Aktiva agenter">{s.activeAgents}</span>}
            </span>
            <span className="ov-name">{shortName(s.name)}</span>
          </div>
        ))}
      </div>
      {detailOpen && (
        <div className="ov-detail">
          {hovered === 'usage' ? <UsageDetail usage={state.usage} /> : session && <SessionInfo session={session} account={state.account} />}
          <div className="ov-hint">Håll Ctrl och klicka för att öppna</div>
        </div>
      )}
    </div>
  );
}
