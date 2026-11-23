import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { SessionSummary, TodoNode, TodoTree } from '../../../shared/contracts';
import { send } from '../lib/api';
import { formatElapsed } from '../lib/format';
import { useNow } from '../lib/useNow';
import { Spinner, StatusChip, TodoIcon } from './Atoms';
import { useAccount } from '../state/account';
import { Modal } from './Modal';

const STATUS_TEXT: Record<TodoNode['status'], string> = { done: 'Klar', in_progress: 'Pågår', not_started: 'Ej påbörjad' };

/** An item (or a whole track) the user wants to talk to the session's Claude about. */
interface Topic {
  node: TodoNode;
  track: TodoNode;
}

/** What every part of the chart needs: titles for dependency text, the chosen topic, and how to choose one. */
interface ChartContext {
  titles: Map<string, string>;
  selectedId: string | null;
  onAsk: (topic: Topic) => void;
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
export function topicReference({ node, track }: Topic): string {
  const owner = node.owner || track.owner;
  if (node === track) return `Angående spåret ${track.id} "${track.title}" i arbetsschemat${owner ? ` (ansvarig ${owner})` : ''}:`;
  return `Angående punkt ${node.id} "${node.title}" i arbetsschemat (spår ${track.id} "${track.title}"${owner ? `, ansvarig ${owner}` : ''}):`;
}

/** Click or Enter/Space chooses the element as the topic to ask about. */
function askHandlers(topic: Topic, ctx: ChartContext) {
  return {
    role: 'button',
    tabIndex: 0,
    title: 'Klicka för att fråga Claude om detta',
    onClick: () => ctx.onAsk(topic),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ctx.onAsk(topic);
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
      <div className="ws-item-box ws-askable" data-selected={ctx.selectedId === node.id ? 'true' : undefined} {...askHandlers({ node, track }, ctx)}>
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
      <div className="ws-track-card ws-askable" data-selected={ctx.selectedId === track.id ? 'true' : undefined} {...askHandlers({ node: track, track }, ctx)}>
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

/** Message box for the chosen topic; sending opens the session in Fokus so the answer is visible. */
function AskBox({ session, topic, onCancel, onSent }: { session: SessionSummary; topic: Topic; onCancel: () => void; onSent: () => void }) {
  const [text, setText] = useState('');
  const submit = (): void => {
    const message = text.trim();
    if (!message) return;
    send('session:send', { id: session.id, text: `${topicReference(topic)}\n\n${message}` });
    send('window:show-session', { id: session.id });
    onSent();
  };
  return (
    <div className="ws-ask">
      <div className="ws-ask-about">
        <span className="muted">Till {session.name} om</span>
        <strong>{topic.node === topic.track ? `spåret ${topic.track.title}` : `${topic.node.id} ${topic.node.title}`}</strong>
        {topic.node !== topic.track && <span className="muted">i {topic.track.title}</span>}
      </div>
      <textarea
        className="input"
        rows={2}
        autoFocus
        placeholder="Skriv till Claude om den här delen… (Enter skickar, Skift+Enter ny rad)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="ws-ask-actions">
        <button type="button" className="btn" onClick={onCancel}>Avbryt</button>
        <button type="button" className="btn primary" disabled={!text.trim()} onClick={submit}>Skicka</button>
      </div>
    </div>
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

function titlesById(tree: TodoTree): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (nodes: TodoNode[]): void =>
    nodes.forEach((n) => {
      map.set(n.id, n.title);
      walk(n.children);
    });
  walk(tree.tracks);
  return map;
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
 * track. Clicking a track or an item opens a message box to the session's Claude about exactly that part.
 */
export function WorkSchema({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const now = useNow(session.startedAt !== null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [remapping, setRemapping] = useState(false);
  const { todo } = session;
  useRoomForTracks(todo?.tracks.length ?? 0);
  const ctx: ChartContext = { titles: todo ? titlesById(todo) : new Map(), selectedId: topic?.node.id ?? null, onAsk: setTopic };

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
      {session.mapping && (
        <div className="ws-mapping"><Spinner small /> Huvudagenten kartlägger projektet. Det kan ta några minuter; schemat dyker upp här när det är klart.</div>
      )}
      {!session.mapping && (!todo || remapping) && <MapPanel session={session} onStarted={() => setRemapping(false)} />}
      {!todo ? null : (
        <div className="ws-chart" style={{ '--accent': session.color } as CSSProperties}>
          <div className="ws-root">
            <div className="ws-root-card">
              <div className="ws-root-title">{todo.title || session.name}</div>
              <Progress value={todo.progress} color={session.color} />
              <div className="muted ws-root-count">{todo.doneItems} av {todo.totalItems} punkter klara · {todo.tracks.length} spår</div>
            </div>
          </div>
          <div
            className="ws-tracks"
            data-single={todo.tracks.length === 1 ? 'true' : undefined}
            style={{ '--tracks': todo.tracks.length, '--track-gap': `${TRACK_GAP}px` } as CSSProperties}
          >
            {todo.tracks.map((t) => <Track key={t.id} track={t} ctx={ctx} />)}
          </div>
          {topic ? (
            <AskBox session={session} topic={topic} onCancel={() => setTopic(null)} onSent={onClose} />
          ) : (
            <div className="ws-legend">
              <span><TodoIcon status="done" /> Klar</span>
              <span><TodoIcon status="in_progress" /> Pågår</span>
              <span><TodoIcon status="not_started" /> Ej påbörjad</span>
              <span><span className="ws-now">Pågår nu</span> arbetas med just nu</span>
              <span><span className="ws-blocked">Väntar</span> väntar på annan punkt</span>
              <span className="ws-legend-hint">Klicka på ett spår eller en punkt för att fråga Claude om just den.</span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
