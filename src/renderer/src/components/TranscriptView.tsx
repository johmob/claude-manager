import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatDetail } from '../../../shared/contracts';
import { ChatDetailContext } from '../state/chatDetail';
import type { TranscriptEntry } from '../../../shared/contracts';
import { send } from '../lib/api';
import { Spinner } from './Atoms';
import { CalloutBox } from './CalloutBox';
import { TaggedText, hasWeight } from './TaggedText';
import { MarkdownText } from './MarkdownText';
import { UserText } from './UserText';

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="thinking">
      <button type="button" className="thinking-toggle" title={open ? 'Dölj tankar' : 'Visa tankar'} onClick={() => setOpen(!open)}>
        {open ? '−' : '+'}
      </button>
      {open && <div className="thinking-text">{text}</div>}
    </div>
  );
}

function ToolStatus({ status }: { status: 'running' | 'ok' | 'error' }) {
  if (status === 'running') return <Spinner small />;
  return <span className={status === 'ok' ? 'tool-ok' : 'tool-err'}>{status === 'ok' ? '✓' : '✕'}</span>;
}

type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>;

function ToolLine({ entry }: { entry: ToolEntry }) {
  return (
    <div className="t-tool-wrap">
      <div className="t-tool">
        <span className="tool-name">{entry.name}</span>
        <span className="tool-summary">{entry.summary}</span>
        <ToolStatus status={entry.status} />
      </div>
      <Thinking text={entry.thinking} />
    </div>
  );
}

/** Consecutive commands collapsed to one quiet line ("3 kommandon · Bash, Write"); a click shows them. */
function ToolGroup({ tools }: { tools: ToolEntry[] }) {
  const [open, setOpen] = useState(false);
  const status = tools.some((t) => t.status === 'running') ? 'running' : tools.some((t) => t.status === 'error') ? 'error' : 'ok';
  const names = [...new Set(tools.map((t) => t.name))];
  return (
    <div className="t-tools">
      <button type="button" className="t-tools-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="t-tools-caret">{open ? '▾' : '▸'}</span>
        {tools.length} {tools.length === 1 ? 'kommando' : 'kommandon'} · {names.slice(0, 3).join(', ')}
        {names.length > 3 ? ' …' : ''}
        <ToolStatus status={status} />
      </button>
      {open && tools.map((t) => <ToolLine key={t.id} entry={t} />)}
    </div>
  );
}

/** Transcript entries with each run of consecutive commands gathered into one group. */
function groupTools(entries: TranscriptEntry[]): Array<Exclude<TranscriptEntry, ToolEntry> | ToolEntry[]> {
  const items: Array<Exclude<TranscriptEntry, ToolEntry> | ToolEntry[]> = [];
  for (const entry of entries) {
    const last = items[items.length - 1];
    if (entry.kind === 'tool' && Array.isArray(last)) last.push(entry);
    else items.push(entry.kind === 'tool' ? [entry] : entry);
  }
  return items;
}

/**
 * The answer of each turn: the main agent's last text before the next message from the user. Everything
 * else it wrote along the way (and all subagent text) is narration and is shown quietly.
 */
function finalAnswers(entries: TranscriptEntry[]): Set<string> {
  const finals = new Set<string>();
  let candidate: string | null = null;
  for (const e of entries) {
    if (e.kind === 'user') {
      if (candidate) finals.add(candidate);
      candidate = null;
    } else if (e.kind === 'assistant' && e.text.trim() && !e.agentId) {
      candidate = e.id;
    }
  }
  if (candidate) finals.add(candidate);
  return finals;
}

/** Text with a link, a web address, a local file path or an image: never folded away. */
const SHOWS_MEDIA = /\]\(|https?:\/\/|file:\/\/|[a-zA-Z]:[\\/][^\s]*\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|pdf)/i;

/** What always shows: your messages, each turn's answer, text tagged as more than narration, links and images, callouts, questions and problems. */
function standsOut(entry: TranscriptEntry, finals: Set<string>, detail: ChatDetail): boolean {
  switch (entry.kind) {
    case 'user':
    case 'callout':
    case 'question':
      return true;
    case 'assistant':
      // Text whose turn still waits for its tags stays with the work, so the turn's end shows all at once.
      if (entry.held) return false;
      return finals.has(entry.id) || hasWeight(entry.blocks, detail) || SHOWS_MEDIA.test(entry.text);
    case 'system':
      return entry.level !== 'info';
    case 'tool':
      return false;
  }
}

type Shown = { kind: 'entry'; entry: Exclude<TranscriptEntry, ToolEntry> } | { kind: 'log'; entries: TranscriptEntry[] } | { kind: 'tools'; tools: ToolEntry[] };

/** "14:32" for entries from this run; saved history has no times, so it shows none. */
function timeOf(entry: TranscriptEntry): string {
  return entry.id.startsWith('history:') ? '' : new Date(entry.at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Everything that does not stand out is gathered into work logs between the entries that do. Detaljerat is
 * the raw stream: every entry on its own; only each run of commands folds to one line.
 */
function arrange(entries: TranscriptEntry[], finals: Set<string>, detail: ChatDetail): Shown[] {
  if (detail === 'detailed') {
    return groupTools(entries).map((item): Shown => (Array.isArray(item) ? { kind: 'tools', tools: item } : { kind: 'entry', entry: item }));
  }
  const shown: Shown[] = [];
  for (const entry of entries) {
    if (standsOut(entry, finals, detail) && entry.kind !== 'tool') {
      shown.push({ kind: 'entry', entry });
      continue;
    }
    const last = shown[shown.length - 1];
    if (last?.kind === 'log') last.entries.push(entry);
    else shown.push({ kind: 'log', entries: [entry] });
  }
  return shown;
}

function keyOf(item: Shown): string {
  return item.kind === 'log' ? item.entries[0]!.id : item.kind === 'tools' ? item.tools[0]!.id : item.entry.id;
}

/** Rounds: each message from the user starts one, holding everything up to the next (work log, answer, callouts). */
function rounds(shown: Shown[]): Shown[][] {
  const result: Shown[][] = [];
  for (const item of shown) {
    if (!result.length || (item.kind === 'entry' && item.entry.kind === 'user')) result.push([]);
    result[result.length - 1]!.push(item);
  }
  return result;
}

/** How long a message stays in the status box before a newer one takes its place. */
const STATUS_DWELL_MS = 30_000;

/**
 * What the main agent is doing, indented under a folded work log: its latest message (two lines; the log
 * opens for more), never commands. A message stays at least half a minute, so the box does not flicker
 * when the agent writes in quick succession; then the newest one takes over.
 */
function LatestAction({ entries, running, onOpen }: { entries: TranscriptEntry[]; running: boolean; onOpen: () => void }) {
  const latest = [...entries].reverse().find((e): e is Extract<TranscriptEntry, { kind: 'assistant' }> => e.kind === 'assistant' && !e.agentId && !!e.text.trim());
  const [shown, setShown] = useState<{ id: string; text: string; since: number } | null>(null);
  useEffect(() => {
    if (!latest || latest.id === shown?.id) return;
    const wait = shown ? Math.max(0, shown.since + STATUS_DWELL_MS - Date.now()) : 0;
    const timer = window.setTimeout(() => setShown({ id: latest.id, text: latest.text, since: Date.now() }), wait);
    return () => window.clearTimeout(timer);
  }, [latest?.id, shown?.id]);
  const body = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);
  // A long message fades out at the bottom; a short one (two points of a list) shows whole.
  useLayoutEffect(() => {
    const el = body.current;
    setCut(!!el && el.scrollHeight > el.clientHeight + 2);
  }, [shown?.id]);
  if (!shown) return null;
  return (
    <button type="button" key={shown.id} className="t-latest" data-running={running ? 'true' : undefined} data-cut={cut ? 'true' : undefined} title="Visa allt under arbetet" onClick={onOpen}>
      <div className="t-latest-body" ref={body}>
        <MarkdownText text={shown.text} />
      </div>
    </button>
  );
}

/**
 * The agent's narration and commands along the way, folded to one quiet line
 * ("Under arbetet · 3 meddelanden · 5 kommandon"); a click shows them.
 */
function WorkLog({ entries, sessionId }: { entries: TranscriptEntry[]; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const texts = entries.filter((e) => e.kind === 'assistant' && e.text.trim()).length;
  const tools = entries.filter((e): e is ToolEntry => e.kind === 'tool');
  const notices = entries.filter((e) => e.kind === 'system').length;
  const running = tools.some((t) => t.status === 'running');
  const parts = [
    texts ? `${texts} ${texts === 1 ? 'meddelande' : 'meddelanden'}` : '',
    tools.length ? `${tools.length} ${tools.length === 1 ? 'kommando' : 'kommandon'}` : '',
    notices ? `${notices} ${notices === 1 ? 'notis' : 'notiser'}` : '',
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <div className="t-log">
      <button type="button" className="t-tools-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="t-tools-caret">{open ? '▾' : '▸'}</span>
        Under arbetet · {parts.join(' · ')}
        {running && <Spinner small />}
      </button>
      {!open && <LatestAction entries={entries} running={running} onOpen={() => setOpen(true)} />}
      {open && (
        <div className="t-log-body">
          {groupTools(entries).map((item) =>
            Array.isArray(item) ? <ToolGroup key={item[0]!.id} tools={item} /> : <Entry key={item.id} entry={item} sessionId={sessionId} final={false} />,
          )}
        </div>
      )}
    </div>
  );
}

function Entry({ entry, sessionId, final }: { entry: Exclude<TranscriptEntry, ToolEntry>; sessionId: string; final: boolean }) {
  const time = timeOf(entry);
  switch (entry.kind) {
    case 'user':
      return (
        <div className="t-user" data-queued={entry.queued ? 'true' : undefined}>
          <div className="bubble">
            <div className="bubble-head">
              Du{time && ` · ${time}`}
              {entry.queued && <span className="bubble-queued"> · väntar på att läsas</span>}
              {entry.queued && (
                <button type="button" className="link-btn bubble-now" title="Avbryt det agenten gör nu, så tar den det här meddelandet direkt" onClick={() => send('session:redirect', { id: sessionId })}>
                  Avbryt och läs nu
                </button>
              )}
            </div>
            <UserText text={entry.text} />
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div className="t-assistant" data-final={final ? 'true' : undefined}>
          {final && <div className="t-answer-head">Svar{time && ` · ${time}`}</div>}
          <Thinking text={entry.thinking} />
          <TaggedText text={entry.text} blocks={entry.blocks} />
        </div>
      );
    case 'callout':
      return <CalloutBox callout={entry.callout} sessionId={sessionId} />;
    case 'question':
      return (
        <div className="t-question">
          <div>{entry.text}</div>
          <div className="t-answer">{entry.answer === null ? 'Väntar på svar…' : `Svar: ${entry.answer}`}</div>
        </div>
      );
    case 'system':
      return <div className="t-system" data-level={entry.level}>{entry.text}</div>;
  }
}

/**
 * Scrollable live transcript: your messages, each turn's answer, callouts and questions stand out; the
 * agent's narration and commands along the way are folded into work logs (Detaljerat shows it all raw,
 * with only the runs of commands folded).
 * Sticks to the bottom unless the user scrolled up.
 */
export function TranscriptView({ entries, sessionId, footer, footerKey }: { entries: TranscriptEntry[]; sessionId: string; footer?: ReactNode; footerKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries, footerKey]);

  const onScroll = (): void => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const finals = finalAnswers(entries);
  const detail = useContext(ChatDetailContext);
  return (
    <div className="transcript" ref={ref} onScroll={onScroll}>
      {rounds(arrange(entries, finals, detail)).map((round) => (
        <section key={keyOf(round[0]!)} className="t-round">
          {round.map((item) =>
            item.kind === 'tools' ? (
              <ToolGroup key={item.tools[0]!.id} tools={item.tools} />
            ) : item.kind === 'log' ? (
              <WorkLog key={item.entries[0]!.id} entries={item.entries} sessionId={sessionId} />
            ) : (
              <Entry key={item.entry.id} entry={item.entry} sessionId={sessionId} final={detail !== 'detailed' && finals.has(item.entry.id)} />
            ),
          )}
        </section>
      ))}
      {footer}
    </div>
  );
}
