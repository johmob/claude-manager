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
import { errorMessage, send } from '../lib/api';
import { Modal } from './Modal';
import { Spinner } from './Atoms';

export type DialogKind = 'chat' | 'project' | 'existing' | 'rules';

/** "Projektmapp: <folder> · Byt…": where new projects go and where existing ones are looked for. */
export function ProjectsRootLine({ settings }: { settings: AppSettings }) {
  return (
    <div className="projects-root">
      <span className="muted">Projektmapp:</span>
      <span className="projects-root-path">{settings.projectsRoot || 'inte vald'}</span>
      <button type="button" className="link-btn" onClick={() => void window.cm.invoke('settings:choose-projects-root', undefined)}>Byt…</button>
    </div>
  );
}

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
      <ProjectsRootLine settings={settings} />
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

const TERMINAL_HINT = 'Ett samtal som fortfarande körs i ett terminalfönster öppnas här direkt, men fortsätter först när du har stängt fönstret.';

/** One saved conversation: title, folder and age, and whether a terminal still runs it. */
function CandidateRow({ candidate, now, showFolder, control }: { candidate: ImportCandidate; now: number; showFolder: boolean; control: ReactNode }) {
  return (
    <label className="import-row" data-live={candidate.terminal ? candidate.terminal.status : undefined}>
      {control}
      <span className="import-main">
        <span className="import-title">{candidate.title}</span>
        <span className="import-meta">{showFolder ? `${candidate.cwd} · ` : ''}{formatAgo(candidate.lastActivity, now)}</span>
      </span>
      {candidate.terminal && <span className="import-live">I terminal · {TERMINAL_STATUS[candidate.terminal.status]}</span>}
    </label>
  );
}

/**
 * Getting back to existing work, in one place: continue recent conversations straight from a list,
 * or describe a project and continue its latest conversation (or start a new one there).
 */
function ExistingProjectDialog({ settings, onClose }: DialogProps) {
  const [description, setDescription] = useState('');
  const [locating, setLocating] = useState(false);
  const [found, setFound] = useState<LocateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<ImportCandidate[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    window.cm
      .invoke('session:import-candidates', undefined)
      .then(setRecent)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const locate = (): void => {
    setLocating(true);
    setError(null);
    window.cm
      .invoke('session:locate-project', { description: description.trim() })
      .then(setFound)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLocating(false));
  };

  const openChosen = (): void => {
    setOpening(true);
    window.cm
      .invoke('session:import', { claudeSessionIds: [...chosen] })
      .then(onClose)
      .catch((e: unknown) => {
        setError(errorMessage(e));
        setOpening(false);
      });
  };

  const toggle = (id: string): void =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (found) return <FolderStep settings={settings} found={found} now={now} onClose={onClose} />;

  return (
    <Modal title="Befintligt projekt" onClose={onClose}>
      <div className="form">
        <ProjectsRootLine settings={settings} />
        <Field label="Beskriv projektet med egna ord" hint="Appen hittar mappen och fortsätter det senaste samtalet där.">
          <textarea className="input" rows={3} autoFocus value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn primary" disabled={locating || description.trim() === ''} onClick={locate}>
            {locating && <Spinner small />} {locating ? 'Letar…' : 'Hitta projekt'}
          </button>
        </div>
        <div className="dialog-divider">eller fortsätt där du slutade</div>
        {!recent && !error && <div className="muted"><Spinner small /> Hämtar senaste samtal…</div>}
        {recent?.length === 0 && <div className="muted">Inga sparade samtal.</div>}
        {recent && recent.length > 0 && (
          <ul className="import-list">
            {recent.map((c) => (
              <li key={c.claudeSessionId}>
                <CandidateRow
                  candidate={c}
                  now={now}
                  showFolder
                  control={<input type="checkbox" checked={chosen.has(c.claudeSessionId)} onChange={() => toggle(c.claudeSessionId)} />}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="field-hint">{TERMINAL_HINT}</p>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Avbryt</button>
          <button type="button" className="btn primary" disabled={!chosen.size || opening} onClick={openChosen}>
            {opening && <Spinner small />} Öppna valda{chosen.size ? ` (${chosen.size})` : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** After the folder is found: continue one of its conversations (the latest is preselected) or start a new one. */
function FolderStep({ settings, found, now, onClose }: DialogProps & { found: LocateResult; now: number }) {
  const [cwd, setCwd] = useState(found.path ?? '');
  const [conversations, setConversations] = useState<ImportCandidate[] | null>(null);
  const [existingCardId, setExistingCardId] = useState<string | null>(null);
  const [choice, setChoice] = useState('');
  const [options, patch] = useOptions(settings);

  useEffect(() => {
    if (!cwd) return;
    setConversations(null);
    window.cm
      .invoke('session:folder-sessions', { cwd })
      .then((r) => {
        setConversations(r.candidates);
        setExistingCardId(r.existingCardId);
        setChoice(r.candidates[0]?.claudeSessionId ?? '');
      })
      .catch(() => setConversations([]));
  }, [cwd]);

  const openCard = (id: string): void => {
    send('window:show-session', { id });
    onClose();
  };

  return (
    <DialogForm
      title="Befintligt projekt"
      onClose={onClose}
      submitLabel={choice ? 'Fortsätt samtalet' : 'Starta nytt samtal'}
      canSubmit={cwd !== '' && conversations !== null}
      onSubmit={async () => {
        await window.cm.invoke('session:open-project', { ...toSessionOptions(options), cwd, ...(choice ? { claudeSessionId: choice } : {}) });
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
      {existingCardId && (
        <div className="found">
          <span>Mappen har redan ett kort i appen. </span>
          <button type="button" className="link-btn" onClick={() => openCard(existingCardId)}>Öppna kortet</button>
        </div>
      )}
      {cwd !== '' && (
        <div className="field">
          <span className="field-label">Samtal</span>
          {!conversations && <div className="muted"><Spinner small /> Hämtar samtal i mappen…</div>}
          {conversations && (
            <ul className="import-list">
              {conversations.map((c) => (
                <li key={c.claudeSessionId}>
                  <CandidateRow
                    candidate={c}
                    now={now}
                    showFolder={false}
                    control={<input type="radio" name="conversation" checked={choice === c.claudeSessionId} onChange={() => setChoice(c.claudeSessionId)} />}
                  />
                </li>
              ))}
              <li>
                <label className="import-row">
                  <input type="radio" name="conversation" checked={choice === ''} onChange={() => setChoice('')} />
                  <span className="import-main"><span className="import-title">Nytt samtal i mappen</span></span>
                </label>
              </li>
            </ul>
          )}
          {conversations?.some((c) => c.terminal) && <span className="field-hint">{TERMINAL_HINT}</span>}
        </div>
      )}
      <OptionFields value={options} onChange={patch} />
    </DialogForm>
  );
}

export function StartDialog({ kind, settings, onClose }: DialogProps & { kind: DialogKind }) {
  switch (kind) {
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
