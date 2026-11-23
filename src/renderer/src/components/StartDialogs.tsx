import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  PERMISSION_CHOICES,
  type AppSettings,
  type EffortChoice,
  type ImportCandidate,
  type LocateResult,
  type ModelChoice,
  type NewSessionOptions,
  type PermissionChoice,
  type TerminalStatus,
} from '../../../shared/contracts';
import { EFFORT_LABEL, formatAgo, PERMISSION_LABEL } from '../lib/format';
import { effortOptions, modelOptions, useAccount } from '../state/account';
import { errorMessage } from '../lib/api';
import { Modal } from './Modal';
import { Spinner } from './Atoms';

export type DialogKind = 'chat' | 'project' | 'existing' | 'import' | 'rules';

interface DialogProps {
  settings: AppSettings;
  onClose: () => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

interface OptionsState {
  model: ModelChoice;
  effort: EffortChoice;
  permissionMode: PermissionChoice;
  prompt: string;
}

/** Model, permission mode and optional first message, shared by the three start dialogs. */
function useOptions(settings: AppSettings): [OptionsState, (patch: Partial<OptionsState>) => void] {
  const [state, setState] = useState<OptionsState>({
    model: settings.defaultModel,
    effort: settings.defaultEffort,
    permissionMode: settings.defaultPermissionMode,
    prompt: '',
  });
  return [state, (patch) => setState((s) => ({ ...s, ...patch }))];
}

function toSessionOptions(o: OptionsState): NewSessionOptions {
  const prompt = o.prompt.trim();
  return { model: o.model, effort: o.effort, permissionMode: o.permissionMode, ...(prompt ? { prompt } : {}) };
}

function OptionFields({ value, onChange }: { value: OptionsState; onChange: (patch: Partial<OptionsState>) => void }) {
  const models = modelOptions(useAccount(), value.model);
  const efforts = effortOptions(models, value.model);
  const chooseModel = (model: ModelChoice): void => {
    // Keep the effort when the new model supports it; otherwise fall back to the model's default.
    const supported = effortOptions(models, model).includes(value.effort);
    onChange({ model, ...(supported ? {} : { effort: 'default' }) });
  };
  return (
    <>
      <div className="field-row">
        <Field label="Modell">
          <select className="input" value={value.model} onChange={(e) => chooseModel(e.target.value as ModelChoice)}>
            {models.map((m) => <option key={m.choice} value={m.choice}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Effort">
          <select className="input" value={value.effort} onChange={(e) => onChange({ effort: e.target.value as EffortChoice })}>
            {efforts.map((level) => <option key={level} value={level}>{EFFORT_LABEL[level]}</option>)}
          </select>
        </Field>
        <Field label="Behörigheter">
          <select className="input" value={value.permissionMode} onChange={(e) => onChange({ permissionMode: e.target.value as PermissionChoice })}>
            {PERMISSION_CHOICES.map((p) => <option key={p} value={p}>{PERMISSION_LABEL[p]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Första meddelande (valfritt)">
        <textarea className="input" rows={3} value={value.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
      </Field>
    </>
  );
}

interface FormProps {
  title: string;
  onClose: () => void;
  submitLabel: string;
  canSubmit: boolean;
  /** Runs on submit; throw to show the message inline. The dialog closes when it resolves. */
  onSubmit: () => Promise<void>;
  children: ReactNode;
}

function DialogForm({ title, onClose, submitLabel, canSubmit, onSubmit, children }: FormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    onSubmit()
      .then(onClose)
      .catch((err: unknown) => {
        setError(errorMessage(err));
        setBusy(false);
      });
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {children}
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Avbryt</button>
          <button type="submit" className="btn primary" disabled={!canSubmit || busy}>
            {busy && <Spinner small />} {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewChatDialog({ settings, onClose }: DialogProps) {
  const [name, setName] = useState('');
  const [options, patch] = useOptions(settings);
  return (
    <DialogForm
      title="Ny chatt"
      onClose={onClose}
      submitLabel="Starta"
      canSubmit
      onSubmit={async () => {
        const trimmed = name.trim();
        await window.cm.invoke('session:new-chat', { ...toSessionOptions(options), ...(trimmed ? { name: trimmed } : {}) });
      }}
    >
      <Field label="Namn (valfritt)">
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <OptionFields value={options} onChange={patch} />
    </DialogForm>
  );
}

function NewProjectDialog({ settings, onClose }: DialogProps) {
  const [name, setName] = useState('');
  const [createGitRepo, setCreateGitRepo] = useState(true);
  const [options, patch] = useOptions(settings);
  return (
    <DialogForm
      title="Nytt projekt"
      onClose={onClose}
      submitLabel="Skapa projekt"
      canSubmit={name.trim() !== ''}
      onSubmit={async () => {
        await window.cm.invoke('session:new-project', { ...toSessionOptions(options), name: name.trim(), createGitRepo });
      }}
    >
      <Field label="Projektnamn">
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={createGitRepo} onChange={(e) => setCreateGitRepo(e.target.checked)} />
        <span>
          Skapa Git-repo
          <span className="field-hint">Skapar lokalt repo + privat repo på GitHub.</span>
        </span>
      </label>
      <OptionFields value={options} onChange={patch} />
    </DialogForm>
  );
}

function ExistingProjectDialog({ settings, onClose }: DialogProps) {
  const [description, setDescription] = useState('');
  const [locating, setLocating] = useState(false);
  const [found, setFound] = useState<LocateResult | null>(null);
  const [cwd, setCwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [options, patch] = useOptions(settings);

  const locate = (): void => {
    setLocating(true);
    setError(null);
    window.cm
      .invoke('session:locate-project', { description: description.trim() })
      .then((r) => {
        setFound(r);
        setCwd(r.path ?? '');
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLocating(false));
  };

  if (!found) {
    return (
      <Modal title="Befintligt projekt" onClose={onClose}>
        <div className="form">
          <Field label="Beskriv projektet med egna ord">
            <textarea className="input" rows={4} autoFocus value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {error && <div className="form-error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Avbryt</button>
            <button type="button" className="btn primary" disabled={locating || description.trim() === ''} onClick={locate}>
              {locating && <Spinner small />} {locating ? 'Letar…' : 'Hitta projekt'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <DialogForm
      title="Befintligt projekt"
      onClose={onClose}
      submitLabel="Starta"
      canSubmit={cwd !== ''}
      onSubmit={async () => {
        await window.cm.invoke('session:open-project', { ...toSessionOptions(options), cwd });
      }}
    >
      <div className="found">
        <div className="found-path">{found.path ?? 'Ingen träff'}</div>
        <div className="muted">{found.reason}</div>
      </div>
      <Field label="Mapp">
        <select className="input" value={cwd} onChange={(e) => setCwd(e.target.value)}>
          {cwd === '' && <option value="">Välj mapp…</option>}
          {found.candidates.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <OptionFields value={options} onChange={patch} />
    </DialogForm>
  );
}

function GroundRulesDialog({ onClose }: DialogProps) {
  const [instructions, setInstructions] = useState('');
  return (
    <DialogForm
      title="Redigera grundregler"
      onClose={onClose}
      submitLabel="Skicka"
      canSubmit={instructions.trim() !== ''}
      onSubmit={async () => {
        await window.cm.invoke('ground-rules:edit', { instructions: instructions.trim() });
      }}
    >
      <Field label="Vad ska ändras i grundreglerna?" hint="Startar en egen session som redigerar den gemensamma CLAUDE.md.">
        <textarea className="input" rows={6} autoFocus value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </Field>
    </DialogForm>
  );
}

const TERMINAL_STATUS: Record<TerminalStatus, string> = {
  busy: 'arbetar',
  waiting: 'väntar på dig',
  idle: 'vilar',
  unknown: 'kör',
};

function ImportDialog({ onClose }: DialogProps) {
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    window.cm
      .invoke('session:import-candidates', undefined)
      .then(setCandidates)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const toggle = (id: string): void =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <DialogForm
      title="Importera sessioner"
      onClose={onClose}
      submitLabel={`Importera${chosen.size ? ` (${chosen.size})` : ''}`}
      canSubmit={chosen.size > 0}
      onSubmit={async () => {
        await window.cm.invoke('session:import', { claudeSessionIds: [...chosen] });
      }}
    >
      <p className="field-hint">
        Hela samtalet följer med. En session som fortfarande körs i ett terminalfönster importeras som stoppad: stäng fönstret när
        agenten är klar med sin tur, och fortsätt sedan här.
      </p>
      {error && <div className="form-error">{error}</div>}
      {!candidates && !error && <div className="muted"><Spinner small /> Letar efter sessioner…</div>}
      {candidates?.length === 0 && <div className="muted">Inga sessioner att importera.</div>}
      {candidates && candidates.length > 0 && (
        <ul className="import-list">
          {candidates.map((c) => (
            <li key={c.claudeSessionId}>
              <label className="import-row" data-live={c.terminal ? c.terminal.status : undefined}>
                <input type="checkbox" checked={chosen.has(c.claudeSessionId)} onChange={() => toggle(c.claudeSessionId)} />
                <span className="import-main">
                  <span className="import-title">{c.title}</span>
                  <span className="import-meta">{c.cwd} · {formatAgo(c.lastActivity, now)}</span>
                </span>
                {c.terminal && <span className="import-live">I terminal · {TERMINAL_STATUS[c.terminal.status]}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </DialogForm>
  );
}

export function StartDialog({ kind, settings, onClose }: DialogProps & { kind: DialogKind }) {
  switch (kind) {
    case 'import':
      return <ImportDialog settings={settings} onClose={onClose} />;
    case 'chat':
      return <NewChatDialog settings={settings} onClose={onClose} />;
    case 'project':
      return <NewProjectDialog settings={settings} onClose={onClose} />;
    case 'existing':
      return <ExistingProjectDialog settings={settings} onClose={onClose} />;
    case 'rules':
      return <GroundRulesDialog settings={settings} onClose={onClose} />;
  }
}
