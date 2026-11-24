import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { SessionSummary, TodoNode, TodoTree } from '../../../shared/contracts';
import { send } from '../lib/api';
import { formatElapsed } from '../lib/format';
import { useNow } from '../lib/useNow';
import { Spinner, StatusChip, TodoIcon } from './Atoms';
import { useAccount } from '../state/account';
import { Modal } from './Modal';
import { arrangeLevel, leavesOf, orderTracks, withoutDone, workStateOf } from '../lib/todoTree';

const STATUS_TEXT: Record<TodoNode['status'], string> = { done: 'Klar', in_progress: 'Pågår', not_started: 'Ej påbörjad' };

/** A track or item with where it sits: its track and the items between the track and it. */
interface Entry {
  node: TodoNode;
  track: TodoNode;
  path: TodoNode[];
}

/** What every part of the chart needs: every item by id, whether an agent works now, the open item, and how to open one. */
interface ChartContext {
  nodes: Map<string, TodoNode>;
  /** An agent is working in the session now; in-progress items are only "live" then. */
  active: boolean;
  /** Short labels for long titles, by id. */
  labels: Record<string, string>;
  selectedId: string | null;
  onPick: (id: string) => void;
}

function Progress({ value, color }: { value: number; color?: string }) {
  return (
    <span className="ws-progress" title={`${value} %`}>
      <span className="ws-progress-bar"><span style={{ width: `${value}%`, ...(color ? { background: color } : {}) }} /></span>
      <span className="ws-progress-pct">{value} %</span>
    </span>
  );
}

/** "fw-a.2 Protokoll" for each dependency of the item that is not done yet. */
function waitingFor(node: TodoNode, nodes: Map<string, TodoNode>): string[] {
  return node.dependsOn.filter((id) => nodes.get(id)?.status !== 'done').map((id) => (nodes.has(id) ? `${id} ${nodes.get(id)?.title}` : id));
}

/** The reference put in front of the user's message, so Claude knows which part of the schema it is about. */
export function topicReference({ node, track }: Entry): string {
  const owner = node.owner || track.owner;
  if (node === track) return `Angående spåret ${track.id} "${track.title}" i arbetsschemat${owner ? ` (ansvarig ${owner})` : ''}:`;
  return `Angående punkt ${node.id} "${node.title}" i arbetsschemat (spår ${track.id} "${track.title}"${owner ? `, ansvarig ${owner}` : ''}):`;
}

/** Click or Enter/Space opens the element's details. */
function pickHandlers(id: string, ctx: ChartContext) {
  return {
    role: 'button',
    tabIndex: 0,
    title: 'Klicka för detaljer och för att kommentera',
    onClick: () => ctx.onPick(id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ctx.onPick(id);
      }
    },
  };
}

/** What the tree shows as a title: the short label when the title is long (the full title is the tooltip). */
function shownTitle(node: TodoNode, ctx: ChartContext): string {
  return ctx.labels[node.id] ?? node.title;
}

/** In progress somewhere in the item, and whether an agent is working now ("live") or not ("rest"). */
function workState(node: TodoNode, ctx: ChartContext): 'live' | 'rest' | undefined {
  return workStateOf(node, ctx.active);
}

const REST_TEXT = 'Markerad som pågående, men ingen agent arbetar just nu';

/** The mark for work along a branch: a pulsing dot while an agent works, a hollow one when it rests. */
function WorkMark({ state }: { state: 'live' | 'rest' }) {
  return <span className="ws-mark" data-state={state} title={state === 'live' ? 'Pågår nu' : REST_TEXT} />;
}

interface Place {
  track: TodoNode;
  trackOwner: string;
  depth: number;
  ctx: ChartContext;
}

/** One level of items: the open ones, then the finished ones folded into one row. */
function Level({ parent, root, ...place }: Place & { parent: TodoNode; root?: boolean }) {
  const { open, done } = arrangeLevel(parent);
  return (
    <ul className={root ? 'ws-items ws-items-root' : 'ws-items'}>
      {open.map((c) => <Item key={c.id} node={c} {...place} />)}
      {done.length > 0 && <DoneRow items={done} {...place} />}
    </ul>
  );
}

/** The finished items of a level as one row, "11 klara"; a click unfolds them. */
function DoneRow({ items, ...place }: Place & { items: TodoNode[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="ws-done-row">
      <button type="button" className="ws-done-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {items.length} klara
      </button>
      {open && (
        <ul className="ws-items">
          {items.map((c) => <Item key={c.id} node={c} {...place} />)}
        </ul>
      )}
    </li>
  );
}

/**
 * A group: an item with sub-items, shown as a heading row with its full title, how many of its parts
 * are done and, once something is done, a progress bar. It folds; a finished group starts folded.
 * The group made by arrangeLevel is no schema item: clicking it only folds it.
 */
function Package({ node, ...place }: Place & { node: TodoNode }) {
  const { ctx } = place;
  const [open, setOpen] = useState(node.status !== 'done');
  const parts = leavesOf(node);
  const done = parts.filter((l) => l.status === 'done').length;
  const work = workState(node, ctx);
  const toggle = (): void => setOpen(!open);
  const pick = ctx.nodes.has(node.id) ? pickHandlers(node.id, ctx) : { role: 'button', tabIndex: 0, onClick: toggle };
  return (
    <li className="ws-item ws-package" data-depth={place.depth > 0 ? 'nested' : undefined} data-todo={node.status} data-open={open ? 'true' : undefined}>
      <div className="ws-package-head ws-askable" data-selected={ctx.selectedId === node.id ? 'true' : undefined} {...pick}>
        <button type="button" className="ws-package-fold" aria-expanded={open} title={open ? 'Fäll ihop' : 'Fäll ut'} onClick={(e) => { e.stopPropagation(); toggle(); }}>
          {open ? '▾' : '▸'}
        </button>
        <span className="ws-package-title" title={node.title}>{shownTitle(node, ctx)}</span>
        {work && <WorkMark state={work} />}
        <span className="ws-package-count">{done}/{parts.length}</span>
      </div>
      {node.progress > 0 && <Progress value={node.progress} />}
      {open && <Level parent={node} {...place} trackOwner={node.owner || place.trackOwner} depth={place.depth + 1} />}
    </li>
  );
}

function Item({ node, ...place }: Place & { node: TodoNode }) {
  if (node.children.length) return <Package node={node} {...place} />;
  const { ctx, trackOwner } = place;
  const work = workState(node, ctx);
  const otherOwner = node.owner && node.owner !== trackOwner ? node.owner : '';
  // Work wins over waiting: an item that is being worked on is never shown as waiting.
  const waiting = work ? [] : waitingFor(node, ctx.nodes);
  const showProgress = node.status === 'in_progress' && node.progress > 0;
  return (
    <li className="ws-item" data-todo={node.status} data-work={work}>
      <div className="ws-item-box ws-askable" data-selected={ctx.selectedId === node.id ? 'true' : undefined} {...pickHandlers(node.id, ctx)}>
        <div className="ws-item-row">
          <TodoIcon status={node.status} />
          <span className="ws-item-title" title={node.title}>{shownTitle(node, ctx)}</span>
          <span className="ws-item-id">{node.id}</span>
        </div>
        {(work || waiting.length > 0 || otherOwner || showProgress) && (
          <div className="ws-item-meta">
            {work === 'live' && <span className="ws-now">Pågår nu</span>}
            {work === 'rest' && <span className="ws-rest" title={REST_TEXT}>Vilande</span>}
            {waiting.length > 0 && <span className="ws-blocked" title={`Väntar på:\n${waiting.join('\n')}`}>väntar på {waiting.length}</span>}
            {otherOwner && <span className="ws-owner">{otherOwner}</span>}
            {showProgress && <Progress value={node.progress} />}
          </div>
        )}
      </div>
    </li>
  );
}

function Track({ track, ctx }: { track: TodoNode; ctx: ChartContext }) {
  const work = workState(track, ctx);
  // The track's state only when it says something: finished, or an agent is working in it.
  const state = track.status === 'done' ? 'Klar' : work === 'live' ? 'Pågår' : '';
  return (
    <div className="ws-track" data-todo={track.status} data-work={work} data-blocked={track.blocked ? 'true' : undefined} data-focus={track.focus ? 'true' : undefined}>
      <div className="ws-track-card ws-askable" data-selected={ctx.selectedId === track.id ? 'true' : undefined} {...pickHandlers(track.id, ctx)}>
        <div className="ws-track-head">
          <TodoIcon status={track.status} />
          <span className="ws-track-title" title={track.title}>{shownTitle(track, ctx)}</span>
          {track.focus && <span className="ws-focus-badge">I fokus</span>}
        </div>
        {(track.owner || state) && (
          <div className="ws-track-meta">
            {track.owner ? <span className="ws-owner">{track.owner}</span> : <span />}
            {state && <span className="ws-track-status">{state}</span>}
          </div>
        )}
        {track.progress > 0 && <Progress value={track.progress} />}
      </div>
      {track.children.length > 0 && <Level parent={track} track={track} trackOwner={track.owner} depth={0} ctx={ctx} root />}
    </div>
  );
}

/** A finished track as one slim line; a click expands it to the full track. */
function DoneTrack({ track, ctx }: { track: TodoNode; ctx: ChartContext }) {
  const [open, setOpen] = useState(false);
  if (open) return <Track track={track} ctx={ctx} />;
  const parts = leavesOf(track);
  return (
    <button type="button" className="ws-done-track" title="Klicka för att fälla ut" onClick={() => setOpen(true)}>
      <span className="ws-done-track-title">✓ {shownTitle(track, ctx)}</span>
      <span className="muted">{parts.filter((l) => l.status === 'done').length}/{parts.length}</span>
    </button>
  );
}

/** Every track and item by id, with its place in the schema. */
function indexSchema(tree: TodoTree): Map<string, Entry> {
  const index = new Map<string, Entry>();
  for (const track of tree.tracks) {
    const walk = (node: TodoNode, path: TodoNode[]): void => {
      index.set(node.id, { node, track, path });
      for (const child of node.children) walk(child, node === track ? [] : [...path, node]);
    };
    walk(track, []);
  }
  return index;
}

/** A clickable line for another item: status, id and title. */
function ItemLink({ entry, onPick, extra }: { entry: Entry; onPick: (id: string) => void; extra?: string }) {
  const { node } = entry;
  return (
    <button type="button" className="wd-link" data-todo={node.status} onClick={() => onPick(node.id)}>
      <TodoIcon status={node.status} />
      <span className="ws-item-id">{node.id}</span>
      <span className="wd-link-title">{node.title}</span>
      {extra && <span className="wd-link-extra">{extra}</span>}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wd-section">
      <div className="wd-section-title">{title}</div>
      <div className="wd-section-body">{children}</div>
    </div>
  );
}

/**
 * One track or item in detail: where it sits, status, the agent's notes, what it waits for, what
 * waits for it and its sub-items. The comment box sends a message about exactly this part.
 */
function ItemDetail({ session, entry, index, onPick, onClose, onSent }: {
  session: SessionSummary;
  entry: Entry;
  index: Map<string, Entry>;
  onPick: (id: string) => void;
  onClose: () => void;
  onSent: (entry: Entry) => void;
}) {
  const [text, setText] = useState('');
  const { node, track, path } = entry;
  const isTrack = node === track;
  const owner = node.owner || [...path].reverse().find((p) => p.owner)?.owner || track.owner;
  const dependsOn = node.dependsOn.map((id) => index.get(id)).filter((e): e is Entry => !!e);
  const neededFor = [...index.values()].filter((e) => e.node.dependsOn.includes(node.id));
  const leaves = leavesOf(node);
  const leftCount = leaves.filter((l) => l.status !== 'done').length;
  useEffect(() => setText(''), [node.id]);

  const submit = (): void => {
    const message = text.trim();
    if (!message) return;
    send('session:send', { id: session.id, text: `${topicReference(entry)}\n\n${message}` });
    onSent(entry);
  };
  /** Asks the agent to mark the track as focused (or no longer), so it glows here and gets worked on first. */
  const toggleFocus = (): void => {
    const request = node.focus
      ? 'Avsluta fokus på det här spåret: ta bort "focus" från det i arbetsschemat.'
      : 'Vi fokuserar på det här spåret nu. Markera det med "focus": true i arbetsschemat och prioritera det. Ta bort "focus" från andra spår om jag inte har sagt att de också ska vara i fokus.';
    send('session:send', { id: session.id, text: `${topicReference(entry)}\n\n${request}` });
    onSent(entry);
  };

  return (
    <Modal title={isTrack ? `Spår ${node.id}` : `Punkt ${node.id}`} onClose={onClose}>
      <div className="wd" style={{ '--accent': session.color } as CSSProperties}>
        {!isTrack && (
          <div className="wd-path">
            {[track, ...path].map((p) => (
              <button key={p.id} type="button" className="wd-crumb" onClick={() => onPick(p.id)}>{p.title}</button>
            ))}
          </div>
        )}
        <div className="wd-title">
          <TodoIcon status={node.status} />
          <span>{node.title}</span>
        </div>
        <div className="wd-facts">
          <span className="wd-status" data-todo={node.status}>{STATUS_TEXT[node.status]}</span>
          {node.blocked && <span className="ws-blocked">Väntar</span>}
          {node.focus && <span className="ws-focus-badge">I fokus</span>}
          {owner && <span className="ws-owner">{owner}</span>}
          <span className="wd-progress"><Progress value={node.progress} /></span>
          {isTrack && (
            <button type="button" className={node.focus ? 'btn small' : 'btn small focus'} onClick={toggleFocus}>
              {node.focus ? 'Avsluta fokus' : 'Fokusera på spåret'}
            </button>
          )}
        </div>
        {node.notes ? (
          <p className="wd-notes">{node.notes}</p>
        ) : (
          <p className="wd-notes wd-notes-empty">Ingen beskrivning ännu. Be agenten nedan, så skriver den en.</p>
        )}
        {dependsOn.length > 0 && (
          <Section title="Väntar på">
            {dependsOn.map((e) => <ItemLink key={e.node.id} entry={e} onPick={onPick} />)}
          </Section>
        )}
        {neededFor.length > 0 && (
          <Section title="Behövs för">
            {neededFor.map((e) => <ItemLink key={e.node.id} entry={e} onPick={onPick} />)}
          </Section>
        )}
        {node.children.length > 0 && (
          <Section title={`Underpunkter · ${leftCount} av ${leaves.length} kvar`}>
            {node.children.map((c) => {
              const childLeaves = leavesOf(c);
              const extra = c.children.length ? `${childLeaves.filter((l) => l.status !== 'done').length} kvar` : c.status === 'in_progress' ? `${c.progress} %` : undefined;
              return <ItemLink key={c.id} entry={index.get(c.id) ?? { node: c, track, path }} onPick={onPick} extra={extra} />;
            })}
          </Section>
        )}
        <div className="wd-comment">
          <textarea
            className="input"
            rows={3}
            autoFocus
            placeholder={`Kommentera ${isTrack ? 'spåret' : node.id} till ${session.name}… (Enter skickar, Skift+Enter ny rad)`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="wd-comment-actions">
            <span className="muted">Referensen till {isTrack ? 'spåret' : 'punkten'} läggs till automatiskt.</span>
            <button type="button" className="btn primary" disabled={!text.trim()} onClick={submit}>Skicka</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Has the session's main agent map the project into its work schema (on Fable with high effort when
 * the account has it, then back to the card's model). Optional text describes the structure to follow.
 */
function MapPanel({ session, onStarted }: { session: SessionSummary; onStarted: () => void }) {
  const [guidance, setGuidance] = useState('');
  const mapper = useAccount()?.models.some((m) => m.choice === 'fable') ? 'Fable' : 'Opus';
  const start = (): void => {
    send('session:map-project', { id: session.id, guidance });
    onStarted();
  };
  return (
    <div className="ws-map">
      <div className="ws-map-title">Kartlägg projektet</div>
      <textarea
        className="input"
        rows={3}
        placeholder="Valfritt: beskriv strukturen, t.ex. CAD-assembly med ~30 delar, custom PCB, firmware för styrenhet och sensornod, webbversion…"
        value={guidance}
        onChange={(e) => setGuidance(e.target.value)}
      />
      <div className="ws-map-actions">
        <span className="muted">
          Huvudagenten läser in hela projektet själv och skriver schemat, så kartan finns i dess eget minne. Den turen körs på {mapper} med hög effort och går sedan tillbaka till kortets modell. Använder en del av kvoten.
        </span>
        <button type="button" className="btn primary" onClick={start}>Kartlägg</button>
      </div>
    </div>
  );
}

const HIDE_DONE_KEY = 'ws-hide-done';

/** "Dölj avklarade", remembered in this viewer's browser storage (and simply off when that is unavailable). */
function useHideDone(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(HIDE_DONE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (value: boolean): void => {
    setOn(value);
    try {
      localStorage.setItem(HIDE_DONE_KEY, value ? '1' : '0');
    } catch {
      // Not remembered; the choice still applies now.
    }
  };
  return [on, set];
}

const TRACK_GAP = 16;

/**
 * The session's work schema as an org chart: project on top, parallel tracks below, items under each
 * track. Clicking a track or an item opens its details, where the user can comment on exactly that part.
 */
export function WorkSchema({ session, onClose }: { session: SessionSummary; onClose: () => void; standalone?: boolean }) {
  const now = useNow(session.turnStartedAt !== null);
  const working = session.status === 'working' || session.activeAgents > 0;
  const [openId, setOpenId] = useState<string | null>(null);
  const [sent, setSent] = useState<Entry | null>(null);
  const [remapping, setRemapping] = useState(false);
  const [hideDone, setHideDone] = useHideDone();
  const { todo } = session;
  // In its own window (from the overlay) the schema already has the whole screen; only the main window is widened.
  const tracks = !todo ? [] : hideDone ? todo.tracks.flatMap((t) => withoutDone(t) ?? []) : todo.tracks;
  const index = todo ? indexSchema(todo) : new Map<string, Entry>();
  const open = openId ? index.get(openId) : undefined;
  const ctx: ChartContext = { nodes: new Map([...index].map(([id, e]) => [id, e.node])), active: session.activeAgents > 0 || session.status === 'working', labels: session.todoLabels, selectedId: openId, onPick: setOpenId };
  const left = todo ? todo.totalItems - todo.doneItems : 0;

  return (
    <Modal title={`Arbetsschema – ${session.name}`} onClose={onClose} size="full">
      <div className="ws-session">
        <StatusChip status={session.status} />
        {working && session.turnStartedAt !== null && <span className="muted">Turen har pågått {formatElapsed(now - session.turnStartedAt)}</span>}
        {working && session.currentTask && <span className="ws-session-task" title={session.currentTask}>Just nu: {session.currentTask}</span>}
        {todo && (
          <label className="ws-toggle" title="Visa bara det som återstår">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
            Dölj avklarade <span className="muted">({todo.doneItems})</span>
          </label>
        )}
        {todo && !session.mapping && (
          <button type="button" className="link-btn ws-remap" onClick={() => setRemapping(!remapping)}>Kartlägg om</button>
        )}
      </div>
      {sent && (
        <div className="ws-sent">
          Skickat till {session.name} om {sent.node === sent.track ? `spåret ${sent.node.title}` : `${sent.node.id} ${sent.node.title}`}.
          <button type="button" className="link-btn" onClick={() => send('window:show-session', { id: session.id })}>Visa svaret i Fokus</button>
          <button type="button" className="icon-btn" aria-label="Stäng" onClick={() => setSent(null)}>✕</button>
        </div>
      )}
      {session.mapping && (
        <div className="ws-mapping"><Spinner small /> Huvudagenten kartlägger projektet. Det kan ta några minuter; schemat dyker upp här när det är klart.</div>
      )}
      {!session.mapping && (!todo || remapping) && <MapPanel session={session} onStarted={() => setRemapping(false)} />}
      {!todo ? null : (
        <div className="ws-chart" style={{ '--accent': session.color } as CSSProperties}>
          <div className="ws-root">
            <div className="ws-root-card">
              <div className="ws-root-title" title={todo.title}>{session.todoLabels['root'] ?? (todo.title || session.name)}</div>
              <div className="ws-root-left">{left === 0 ? 'Allt klart' : `${left} av ${todo.totalItems} punkter kvar`}</div>
              <Progress value={todo.progress} color={session.color} />
              <div className="muted ws-root-count">
                Projektet {todo.progress} % klart · {todo.inProgressItems} {ctx.active ? 'pågår' : 'vilande'} ·{todo.tracks.length} spår
              </div>
            </div>
          </div>
          <div
            className="ws-tracks"
            data-single={tracks.length === 1 ? 'true' : undefined}
            style={{ '--tracks': tracks.length, '--track-gap': `${TRACK_GAP}px` } as CSSProperties}
          >
            {orderTracks(tracks, ctx.active).map((t) => (t.status === 'done' ? <DoneTrack key={t.id} track={t} ctx={ctx} /> : <Track key={t.id} track={t} ctx={ctx} />))}
            {!tracks.length && <div className="ws-all-done">Allt är klart. Avklarade punkter är dolda.</div>}
          </div>
          <div className="ws-legend">
            <span><TodoIcon status="done" /> Klar</span>
            <span><TodoIcon status="in_progress" /> Pågår</span>
            <span><TodoIcon status="not_started" /> Ej påbörjad</span>
            <span><span className="ws-now">Pågår nu</span> en agent arbetar</span>
            <span><span className="ws-rest">Vilande</span> pågående, ingen agent arbetar</span>
            <span><span className="ws-blocked">väntar på 2</span> väntar på andra punkter</span>
            <span className="ws-legend-hint">Klicka på ett spår eller en punkt för detaljer och för att kommentera.</span>
          </div>
        </div>
      )}
      {open && (
        <ItemDetail
          session={session}
          entry={open}
          index={index}
          onPick={setOpenId}
          onClose={() => setOpenId(null)}
          onSent={(entry) => {
            setOpenId(null);
            setSent(entry);
          }}
        />
      )}
    </Modal>
  );
}
