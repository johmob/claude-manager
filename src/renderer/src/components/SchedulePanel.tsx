import { useState, type CSSProperties } from 'react';
import type { ScheduledJobView, SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';
import { SessionMark } from './SessionMark';

const OPEN_KEY = 'schedule-panel-open';

/** "om 12 min", "om 3 tim", "i morgon 08:57", "fre 08:57" */
function whenNext(iso: string | null): string {
  if (!iso) return 'pausad';
  const at = new Date(iso);
  const minutes = Math.round((at.getTime() - Date.now()) / 60_000);
  if (minutes < 1) return 'nu';
  if (minutes < 60) return `om ${minutes} min`;
  if (minutes < 6 * 60) return `om ${Math.round(minutes / 60)} tim`;
  const time = at.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (at.toDateString() === new Date().toDateString()) return `i dag ${time}`;
  if (at.toDateString() === tomorrow.toDateString()) return `i morgon ${time}`;
  return `${at.toLocaleDateString('sv-SE', { weekday: 'short' })} ${time}`;
}

function lastRunText(job: ScheduledJobView): string {
  if (!job.lastRun) return 'aldrig körd';
  const at = new Date(job.lastRun.at).toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return `${job.lastRun.ok ? '✓' : '✕'} ${at}`;
}

function Job({ session, job }: { session: SessionSummary; job: ScheduledJobView }) {
  const act = (action: 'run' | 'pause' | 'resume' | 'delete'): void => send('schedule:act', { id: session.id, jobId: job.id, action });
  return (
    <li className="sp-job" data-paused={job.enabled ? undefined : 'true'}>
      <div className="sp-job-head">
        <span className="sp-job-name" title={job.kind === 'agent' ? job.prompt : job.command}>{job.name}</span>
        <span className="sp-kind" data-kind={job.kind} title={job.kind === 'agent' ? 'Skickas till agenten (kostar tokens)' : 'Körs av appen utan agent (inga tokens)'}>
          {job.kind === 'agent' ? 'Agent' : 'Lokalt'}
        </span>
      </div>
      <div className="sp-job-meta">
        <span>{job.rhythm}</span>
        <span className="muted">Nästa: {whenNext(job.nextRun)}</span>
      </div>
      <div className="sp-job-meta">
        <span className="muted" data-failed={job.lastRun && !job.lastRun.ok ? 'true' : undefined} title={job.lastRun?.output || undefined}>Senast: {lastRunText(job)}</span>
      </div>
      <div className="sp-job-meta">
        <span className="sp-actions">
          <button type="button" className="link-btn" onClick={() => act('run')}>Kör nu</button>
          <button type="button" className="link-btn" onClick={() => act(job.enabled ? 'pause' : 'resume')}>{job.enabled ? 'Pausa' : 'Starta'}</button>
          <button type="button" className="link-btn danger-text" onClick={() => act('delete')}>Ta bort</button>
        </span>
      </div>
    </li>
  );
}

/**
 * Everything scheduled, by project: a narrow strip on the right of Fokus that folds out. Each job shows how
 * often it runs, when next, how the last run went, whether it runs locally or by the agent, and can be run
 * now, paused or removed.
 */
export function SchedulePanel({ sessions }: { sessions: SessionSummary[] }) {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === 'true');
  const toggle = (): void => {
    localStorage.setItem(OPEN_KEY, String(!open));
    setOpen(!open);
  };
  const projects = sessions.filter((s) => s.schedule.length || s.scheduleProblem);
  const count = projects.reduce((n, s) => n + s.schedule.length, 0);
  if (!open) {
    return (
      <button type="button" className="sp-strip" title="Schemalagda jobb" onClick={toggle}>
        <span className="sp-strip-label">Schemalagt</span>
        {count > 0 && <span className="sp-count">{count}</span>}
      </button>
    );
  }
  return (
    <aside className="sp" aria-label="Schemalagda jobb">
      <header className="sp-head">
        <strong>Schemalagt</strong>
        <button type="button" className="icon-btn" title="Fäll ihop" onClick={toggle}>›</button>
      </header>
      {projects.length === 0 ? (
        <p className="muted sp-empty">Inget schemalagt. Be en agent schemalägga något, så hamnar det här.</p>
      ) : (
        projects.map((s) => (
          <section key={s.id} className="sp-project" style={{ '--c': s.color } as CSSProperties}>
            <div className="sp-project-head">
              <SessionMark name={s.name} icon={s.icon} color={s.color} size={15} />
              <span>{s.name}</span>
            </div>
            {s.scheduleProblem && <p className="sp-problem">{s.scheduleProblem}</p>}
            <ul>{s.schedule.map((job) => <Job key={job.id} session={s} job={job} />)}</ul>
          </section>
        ))
      )}
    </aside>
  );
}
