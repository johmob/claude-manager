import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ScheduledJobView, SessionCron, SessionSummary } from '../../../shared/contracts';
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

/** A small card in place over the panel: what the job is for, what it runs, when, and how the last run went. */
function JobDetail({ job, onClose }: { job: ScheduledJobView; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  const runs = job.kind === 'agent' ? job.prompt : job.command;
  return (
    <div ref={ref} className="sp-pop" role="dialog" aria-label={job.name}>
      <div className="sp-pop-head">
        <strong>{job.name}</strong>
        <button type="button" className="icon-btn" title="Stäng" onClick={onClose}>×</button>
      </div>
      <p className="sp-pop-desc">{job.description || <span className="muted">Ingen beskrivning.</span>}</p>
      <dl className="sp-pop-facts">
        <dt>Typ</dt>
        <dd>{job.kind === 'agent' ? 'Skickas till agenten (kostar tokens)' : `Körs lokalt av appen, utan tokens${job.wakeAgentOnFailure ? '; väcker agenten om det misslyckas' : ''}`}</dd>
        <dt>När</dt>
        <dd>{job.rhythm} <span className="muted">({job.cron})</span></dd>
        <dt>Nästa</dt>
        <dd>{job.enabled ? whenNext(job.nextRun) : 'pausad'}</dd>
        <dt>Senast</dt>
        <dd>{lastRunText(job)}</dd>
      </dl>
      <div className="sp-pop-label">{job.kind === 'agent' ? 'Meddelande till agenten' : 'Kommando'}</div>
      <pre className="sp-pop-run">{runs}</pre>
      {job.lastRun?.output && (
        <>
          <div className="sp-pop-label">Utdata senast</div>
          <pre className="sp-pop-run">{job.lastRun.output}</pre>
        </>
      )}
    </div>
  );
}

function Job({ session, job }: { session: SessionSummary; job: ScheduledJobView }) {
  const [open, setOpen] = useState(false);
  const act = (action: 'run' | 'pause' | 'resume' | 'delete'): void => send('schedule:act', { id: session.id, jobId: job.id, action });
  return (
    <li className="sp-job" data-paused={job.enabled ? undefined : 'true'} data-open={open ? 'true' : undefined}>
      <div className="sp-job-head sp-job-click" title="Visa detaljer" onClick={() => setOpen((o) => !o)}>
        <span className="sp-job-name">{job.name}</span>
        <span className="sp-kind" data-kind={job.kind} title={job.kind === 'agent' ? 'Skickas till agenten (kostar tokens)' : 'Körs av appen utan agent (inga tokens)'}>
          {job.kind === 'agent' ? 'Agent' : 'Lokalt'}
        </span>
      </div>
      <div className="sp-state" data-on={job.enabled && job.nextRun ? 'true' : undefined}>
        <span className="sp-state-dot" aria-hidden />
        {job.enabled
          ? job.nextRun
            ? <span><b>Aktiv</b> · körs av sig själv {whenNext(job.nextRun)}</span>
            : <span><b>Aktiv</b> · ingen kommande körning</span>
          : <span><b>Pausad</b> · körs inte förrän du startar den</span>}
      </div>
      <div className="sp-job-meta">
        <span className="muted">{job.rhythm}</span>
      </div>
      <div className="sp-job-meta">
        <span className="muted" data-failed={job.lastRun && !job.lastRun.ok ? 'true' : undefined} title={job.lastRun?.output || undefined}>Senast: {lastRunText(job)}</span>
      </div>
      <div className="sp-job-meta">
        <span className="sp-actions">
          {!(job.enabled && job.nextRun) && <button type="button" className="link-btn" title="Kör en gång direkt" onClick={() => act('run')}>Kör nu</button>}
          <button type="button" className="link-btn" onClick={() => act(job.enabled ? 'pause' : 'resume')}>{job.enabled ? 'Pausa' : 'Aktivera'}</button>
          <button type="button" className="link-btn danger-text" onClick={() => act('delete')}>Ta bort</button>
        </span>
      </div>
      {open && <JobDetail job={job} onClose={() => setOpen(false)} />}
    </li>
  );
}

/** A job the agent made with Claude Code's CronCreate: shown, but run and kept by Claude Code, not the app. */
function SessionCronJob({ job }: { job: SessionCron }) {
  const [open, setOpen] = useState(false);
  const next = job.nextFireAt ? whenNext(new Date(job.nextFireAt).toISOString()) : '';
  return (
    <li className="sp-job sp-cron" data-open={open ? 'true' : undefined}>
      <div className="sp-job-head sp-job-click" title="Visa detaljer" onClick={() => setOpen((o) => !o)}>
        <span className="sp-job-name">{job.prompt.split(/\r?\n/)[0] || job.cron}</span>
        <span className="sp-kind" data-kind="session" title={job.durable ? 'Claude Code kör det och sparar det i projektets .claude/scheduled_tasks.json' : 'Claude Code kör det bara så länge sessionen är igång'}>
          {job.durable ? 'Claude Code' : 'Sessionen'}
        </span>
      </div>
      <div className="sp-state" data-on="true">
        <span className="sp-state-dot" aria-hidden />
        <span><b>Aktiv</b> · {job.schedule}{next ? ` · nästa ${next}` : ''}</span>
      </div>
      {open && (
        <div className="sp-pop">
          <p className="sp-pop-desc">{job.durable ? 'Lagt av agenten med Claude Codes egen schemaläggning. Det sparas av Claude Code och körs när sessionen är igång.' : 'Lagt av agenten med Claude Codes egen schemaläggning. Det försvinner när sessionen avslutas eller appen startas om.'}{job.recurring ? ' Återkommande; Claude Code avslutar det efter 30 dagar.' : ' Körs en gång.'}</p>
          <dl className="sp-pop-facts">
            <dt>När</dt>
            <dd>{job.schedule} <span className="muted">({job.cron})</span></dd>
            <dt>Id</dt>
            <dd>{job.id}</dd>
          </dl>
          <div className="sp-pop-label">Meddelande till agenten</div>
          <pre className="sp-pop-run">{job.prompt}</pre>
        </div>
      )}
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
  const projects = sessions.filter((s) => s.schedule.length || s.sessionCrons.length || s.scheduleProblem);
  const count = projects.reduce((n, s) => n + s.schedule.length + s.sessionCrons.length, 0);
  const active = projects.some((s) => s.sessionCrons.length > 0 || s.schedule.some((j) => j.enabled && j.nextRun));
  if (!open) {
    return (
      <button type="button" className="sp-strip" title="Schemalagda jobb" onClick={toggle}>
        <span className="sp-strip-label">Schemalagt</span>
        {count > 0 && <span className="sp-count" data-active={active ? 'true' : undefined} title={active ? 'Minst ett jobb är aktivt och körs av sig själv' : 'Alla jobb är pausade'}>{count}</span>}
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
            <ul>
              {s.schedule.map((job) => <Job key={job.id} session={s} job={job} />)}
              {s.sessionCrons.map((job) => <SessionCronJob key={job.id} job={job} />)}
            </ul>
          </section>
        ))
      )}
    </aside>
  );
}
