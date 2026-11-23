import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { SessionSummary, TodoNode, TodoTree } from '../../../shared/contracts';
import { send } from '../lib/api';
import { formatElapsed } from '../lib/format';
import { useNow } from '../lib/useNow';
import { Spinner, StatusChip, TodoIcon } from './Atoms';
import { useAccount } from '../state/account';
import { Modal } from './Modal';

const STATUS_TEXT: Record<TodoNode['status'], string> = { done: 'Klar', in_progress: 'Pågår', not_started: 'Ej påbörjad' };

/** A track or item with where it sits: its track and the items between the track and it. */
interface Entry {
  node: TodoNode;
  track: TodoNode;
  path: TodoNode[];
}

/** What every part of the chart needs: titles for dependency text, the open item, and how to open one. */
interface ChartContext {
  titles: Map<string, string>;
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

/** "Väntar på: fw-a.2 Protokoll, …" for an item whose dependencies are not done. */
function waitingFor(node: TodoNode, titles: Map<string, string>): string {
  return `Väntar på: ${node.dependsOn.map((id) => (titles.has(id) ? `${id} ${titles.get(id)}` : id)).join(', ')}`;
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

function Item({ node, track, trackOwner, ctx }: { node: TodoNode; track: TodoNode; trackOwner: string; ctx: ChartContext }) {
  const now = node.status === 'in_progress' && !node.children.length;
  const otherOwner = node.owner && node.owner !== trackOwner ? node.owner : '';
  const hasMeta = node.status === 'in_progress' || node.blocked || otherOwner;
  return (
    <li className="ws-item" data-todo={node.status} data-now={now ? 'true' : undefined} data-blocked={node.blocked ? 'true' : undefined}>
      <div className="ws-item-box ws-askable" data-selected={ctx.selectedId === node.id ? 'true' : undefined} {...pickHandlers(node.id, ctx)}>
        <div className="ws-item-row">
          <TodoIcon status={node.status} />
          <span className="ws-item-id">{node.id}</span>
          <span className="ws-item-title">{node.title}</span>
        </div>
        {hasMeta && (
          <div className="ws-item-meta">
            {now && <span className="ws-now">Pågår nu</span>}
            {node.blocked && <span className="ws-blocked">Väntar</span>}
            {otherOwner && <span className="ws-owner">{otherOwner}</span>}
            {node.status === 'in_progress' && <Progress value={node.progress} />}
          </div>
        )}
        {node.blocked && <div className="ws-waiting">{waitingFor(node, ctx.titles)}</div>}
      </div>
      {node.children.length > 0 && (
        <ul className="ws-items">
          {node.children.map((c) => <Item key={c.id} node={c} track={track} trackOwner={node.owner || trackOwner} ctx={ctx} />)}
        </ul>
      )}
    </li>
  );
}

function Track({ track, ctx }: { track: TodoNode; ctx: ChartContext }) {
  return (
    <div className="ws-track" data-todo={track.status} data-blocked={track.blocked ? 'true' : undefined}>
      <div className="ws-track-card ws-askable" data-selected={ctx.selectedId === track.id ? 'true' : undefined} {...pickHandlers(track.id, ctx)}>
        <div className="ws-track-head">
          <TodoIcon status={track.status} />
          <span className="ws-track-title">{track.title}</span>
        </div>
        <div className="ws-track-meta">
          {track.owner ? <span className="ws-owner">{track.owner}</span> : <span />}
          <span className="ws-track-status">{STATUS_TEXT[track.status]}</span>
        </div>
        <Progress value={track.progress} />
      </div>
      {track.children.length > 0 && (
        <ul className="ws-items ws-items-root">
          {track.children.map((c) => <Item key={c.id} node={c} track={track} trackOwner={track.owner} ctx={ctx} />)}
        </ul>
      )}
    </div>
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

function leavesOf(node: TodoNode): TodoNode[] {
  return node.children.length ? node.children.flatMap(leavesOf) : [node];
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
          {owner && <span className="ws-owner">{owner}</span>}
          <span className="wd-progress"><Progress value={node.progress} /></span>
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

/** Width a track column needs to read comfortably, the gap between columns, and the modal's own margins. */
const TRACK_WIDTH = 290;
const TRACK_GAP = 16;
const MODAL_CHROME = 90;

/**
 * While the schema is open, maximises the window if the tracks would not fit side by side, and
 * restores it on close (only if it was this view that maximised it).
 */
function useRoomForTracks(trackCount: number): void {
  useEffect(() => {
    if (trackCount < 2) return;
    let open = true;
    let maximised = false;
    const width = trackCount * TRACK_WIDTH + (trackCount - 1) * TRACK_GAP + MODAL_CHROME;
    void window.cm.invoke('window:ensure-width', { width }).then((did) => {
      maximised = did;
      if (did && !open) void window.cm.invoke('window:snap', { mode: 'restore' });
    });
    return () => {
      open = false;
      if (maximised) void window.cm.invoke('window:snap', { mode: 'restore' });
    };
  }, [trackCount]);
}

/**
 * The session's work schema as an org chart: project on top, parallel tracks below, items under each
 * track. Clicking a track or an item opens its details, where the user can comment on exactly that part.
 */
export function WorkSchema({ session, onClose, standalone }: { session: SessionSummary; onClose: () => void; standalone?: boolean }) {
  const now = useNow(session.startedAt !== null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sent, setSent] = useState<Entry | null>(null);
  const [remapping, setRemapping] = useState(false);
  const { todo } = session;
  // In its own window (from the overlay) the schema already has the whole screen; only the main window is widened.
  useRoomForTracks(standalone ? 0 : (todo?.tracks.length ?? 0));
  const index = todo ? indexSchema(todo) : new Map<string, Entry>();
  const open = openId ? index.get(openId) : undefined;
  const ctx: ChartContext = { titles: new Map([...index].map(([id, e]) => [id, e.node.title])), selectedId: openId, onPick: setOpenId };
  const left = todo ? todo.totalItems - todo.doneItems : 0;

  return (
    <Modal title={`Arbetsschema – ${session.name}`} onClose={onClose} size="full">
      <div className="ws-session">
        <StatusChip status={session.status} />
        {session.startedAt !== null && <span className="muted">Tid sedan start {formatElapsed(now - session.startedAt)}</span>}
        {session.currentTask && <span className="ws-session-task">Just nu: {session.currentTask}</span>}
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
              <div className="ws-root-title">{todo.title || session.name}</div>
              <div className="ws-root-left">{left === 0 ? 'Allt klart' : `${left} av ${todo.totalItems} punkter kvar`}</div>
              <Progress value={todo.progress} color={session.color} />
              <div className="muted ws-root-count">
                Projektet {todo.progress} % klart · {todo.inProgressItems} pågår · {todo.tracks.length} spår
              </div>
            </div>
          </div>
          <div
            className="ws-tracks"
            data-single={todo.tracks.length === 1 ? 'true' : undefined}
            style={{ '--tracks': todo.tracks.length, '--track-gap': `${TRACK_GAP}px` } as CSSProperties}
          >
            {todo.tracks.map((t) => <Track key={t.id} track={t} ctx={ctx} />)}
          </div>
          <div className="ws-legend">
            <span><TodoIcon status="done" /> Klar</span>
            <span><TodoIcon status="in_progress" /> Pågår</span>
            <span><TodoIcon status="not_started" /> Ej påbörjad</span>
            <span><span className="ws-now">Pågår nu</span> arbetas med just nu</span>
            <span><span className="ws-blocked">Väntar</span> väntar på annan punkt</span>
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
