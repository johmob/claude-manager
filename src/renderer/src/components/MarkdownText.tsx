import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components = {
  // Links open nothing: render them as plain text.
  a: ({ children }: { children?: ReactNode }) => <span className="md-link">{children}</span>,
};

/** Agent text rendered as GitHub-flavoured markdown. */
export function MarkdownText({ text, className = 'md' }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{text}</Markdown>
    </div>
  );
}
