import { useLayoutEffect, useRef, useState } from 'react';
import type { TranscriptEntry } from '../../../shared/contracts';
import { Spinner } from './Atoms';
import { CalloutBox } from './CalloutBox';
import { TaggedText, hasWeight } from './TaggedText';

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
function standsOut(entry: TranscriptEntry, finals: Set<string>): boolean {
  switch (entry.kind) {
    case 'user':
    case 'callout':
    case 'question':
      return true;
    case 'assistant':
      return finals.has(entry.id) || hasWeight(entry.blocks) || SHOWS_MEDIA.test(entry.text);
    case 'system':
      return entry.level !== 'info';
    case 'tool':
      return false;
  }
}

type Shown = { kind: 'entry'; entry: Exclude<TranscriptEntry, ToolEntry> } | { kind: 'log'; entries: TranscriptEntry[] };

/** "14:32" for entries from this run; saved history has no times, so it shows none. */
function timeOf(entry: TranscriptEntry): string {
  return entry.id.startsWith('history:') ? '' : new Date(entry.at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

/** Everything that does not stand out is gathered into work logs between the entries that do. */
function arrange(entries: TranscriptEntry[], finals: Set<string>): Shown[] {
  const shown: Shown[] = [];
  for (const entry of entries) {
    if (standsOut(entry, finals) && entry.kind !== 'tool') {
      shown.push({ kind: 'entry', entry });
      continue;
    }
    const last = shown[shown.length - 1];
    if (last?.kind === 'log') last.entries.push(entry);
    else shown.push({ kind: 'log', entries: [entry] });
  }
  return shown;
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
        <div className="t-user">
          <div className="bubble">
            <div className="bubble-head">Du{time && ` · ${time}`}</div>
            {entry.text}
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
 * agent's narration and commands along the way are folded into work logs. Sticks to the bottom unless
 * the user scrolled up.
 */
export function TranscriptView({ entries, sessionId }: { entries: TranscriptEntry[]; sessionId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = (): void => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const finals = finalAnswers(entries);
  return (
    <div className="transcript" ref={ref} onScroll={onScroll}>
      {rounds(arrange(entries, finals)).map((round) => (
        <section key={round[0]!.kind === 'log' ? round[0]!.entries[0]!.id : round[0]!.entry.id} className="t-round">
          {round.map((item) =>
            item.kind === 'log' ? (
              <WorkLog key={item.entries[0]!.id} entries={item.entries} sessionId={sessionId} />
            ) : (
              <Entry key={item.entry.id} entry={item.entry} sessionId={sessionId} final={finals.has(item.entry.id)} />
            ),
          )}
        </section>
      ))}
    </div>
  );
}
