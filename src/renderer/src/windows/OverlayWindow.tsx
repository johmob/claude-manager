import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { SessionSummary, UsageSnapshot, UsageWindow } from '../../../shared/contracts';
import { AgentsIcon } from '../components/Icons';
import { InfoBar, InfoRow, SessionInfo } from '../components/SessionInfo';
import { send } from '../lib/api';
import { formatReset, monogram } from '../lib/format';
import { usageLevel } from '../lib/usage';
import { useAppState } from '../state/useAppState';
import { useTheme } from '../lib/theme';

const MAX_NAME = 10;

function shortName(name: string): string {
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}

/** Small mark on the icon for states that need a glance: waiting, done, error. */
const STATUS_MARK: Partial<Record<SessionSummary['status'], string>> = { waiting: '!', done: '✓', error: '×', limited: '⏸' };

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

const LEVEL_COLOR = { ok: '#3fb950', notice: '#facc15', warn: '#ff8a1f', crit: '#ff3b30' } as const;

function UsageDetail({ usage }: { usage: UsageSnapshot }) {
  const row = (label: string, w: UsageWindow | null, weekday: boolean) => {
    const used = w ? Math.round(w.utilization) : null;
    const reset = w ? formatReset(w.resetsAt, weekday) : '';
    return (
      <InfoRow label={label}>
        {used === null ? (
          <span className="si-dim">ingen data</span>
        ) : (
          <InfoBar percent={used} color={LEVEL_COLOR[usageLevel(used)]}>
            {used} % {reset && <span className="si-dim">· {reset}</span>}
          </InfoBar>
        )}
      </InfoRow>
    );
  };
  return (
    <div className="session-info">
      <div className="si-head"><strong className="si-name">Användning</strong></div>
      <div className="si-grid">
        {row('5 tim', usage.fiveHour, false)}
        {row('Vecka', usage.sevenDay, true)}
      </div>
    </div>
  );
}

/** How many of the session's agents are working, out of all agents of its current turn. */
function AgentCount({ session }: { session: SessionSummary }) {
  if (!session.agentCount) return <span className="ov-agents" title="Inte startad"><AgentsIcon />–</span>;
  return (
    <span className="ov-agents" data-busy={session.activeAgents > 0} title={`${session.activeAgents} av ${session.agentCount} agenter jobbar`}>
      <AgentsIcon />
      <b>{session.activeAgents}</b>/{session.agentCount}
    </span>
  );
}

/**
 * Click-through strip at the top of the screen: usage first, then one icon per session with its
 * status, and how many of its agents are working. Hovering shows details below. Icons take clicks while hovered
 * (click answers its questions if it has any, otherwise opens the session; right-click shows its work schema);
 * everything else stays click-through.
 */
export function OverlayWindow() {
  const state = useAppState();
  useTheme(state?.settings.theme);
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
      onMouseMove={(e: MouseEvent) => setInteractive(e.ctrlKey || (e.target instanceof Element && !!e.target.closest('.ov-cell')))}
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
        <span className="ov-divider" />
        {state.sessions.map((s) => (
          <div
            key={s.id}
            className="ov-cell"
            data-status={s.status}
            style={{ '--accent': s.color } as CSSProperties}
            onMouseEnter={() => setHovered(s.id)}
            onClick={() => (s.questions.length ? send('popup:open', { kind: 'questions', id: s.id }) : send('window:show-session', { id: s.id }))}
            onContextMenu={(e) => {
              e.preventDefault();
              setHovered(null);
              send('popup:open', { kind: 'schema', id: s.id });
            }}
          >
            <span className="ov-icon">
              <span className="ov-ring" />
              <span className="ov-letters">{monogram(s.name)}</span>
              {STATUS_MARK[s.status] && <span className="ov-mark">{STATUS_MARK[s.status]}</span>}
            </span>
            <span className="ov-name">{shortName(s.name)}</span>
            <AgentCount session={s} />
          </div>
        ))}
      </div>
      {detailOpen && (
        <div className="ov-detail">
          {hovered === 'usage' ? <UsageDetail usage={state.usage} /> : session && <SessionInfo session={session} account={state.account} />}
          <div className="ov-hint">{hovered === 'usage' ? 'Uppdateras automatiskt' : session?.questions.length ? 'Klicka: svara på frågorna · Högerklicka: arbetsschema' : 'Klicka: öppna i appen · Högerklicka: arbetsschema'}</div>
        </div>
      )}
    </div>
  );
}
