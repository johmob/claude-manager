import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components = {
  // Links open nothing: render them as plain text.
  a: ({ children }: { children?: ReactNode }) => <span className="md-link">{children}</span>,
  // A table scrolls sideways inside its own box when it must, so it never widens the text around it.
  table: ({ children }: { children?: ReactNode }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

/** Agent text rendered as GitHub-flavoured markdown. */
export function MarkdownText({ text, className = 'md' }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{text}</Markdown>
    </div>
  );
}
