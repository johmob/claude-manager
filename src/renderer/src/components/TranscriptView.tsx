import { useLayoutEffect, useRef, useState } from 'react';
import type { TranscriptEntry } from '../../../shared/contracts';
import { Spinner } from './Atoms';
import { CalloutBox } from './CalloutBox';
import { MarkdownText } from './MarkdownText';

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

function Entry({ entry, sessionId }: { entry: Exclude<TranscriptEntry, ToolEntry>; sessionId: string }) {
  switch (entry.kind) {
    case 'user':
      return <div className="t-user"><div className="bubble">{entry.text}</div></div>;
    case 'assistant':
      return (
        <div className="t-assistant">
          <Thinking text={entry.thinking} />
          <MarkdownText text={entry.text} />
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

/** Scrollable live transcript (commands collapsed by default); sticks to the bottom unless the user scrolled up. */
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

  return (
    <div className="transcript" ref={ref} onScroll={onScroll}>
      {groupTools(entries).map((item) =>
        Array.isArray(item) ? <ToolGroup key={item[0]!.id} tools={item} /> : <Entry key={item.id} entry={item} sessionId={sessionId} />,
      )}
    </div>
  );
}
