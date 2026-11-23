import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TranscriptEntry } from '../../../shared/contracts';
import { Spinner } from './Atoms';

const markdownComponents = {
  // Links open nothing: render them as plain text.
  a: ({ children }: { children?: ReactNode }) => <span className="md-link">{children}</span>,
};

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

function Entry({ entry }: { entry: TranscriptEntry }) {
  switch (entry.kind) {
    case 'user':
      return <div className="t-user"><div className="bubble">{entry.text}</div></div>;
    case 'assistant':
      return (
        <div className="t-assistant">
          <Thinking text={entry.thinking} />
          <div className="md">
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{entry.text}</Markdown>
          </div>
        </div>
      );
    case 'tool':
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

/** Scrollable live transcript; sticks to the bottom unless the user scrolled up. */
export function TranscriptView({ entries }: { entries: TranscriptEntry[] }) {
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
      {entries.map((e) => <Entry key={e.id} entry={e} />)}
    </div>
  );
}
