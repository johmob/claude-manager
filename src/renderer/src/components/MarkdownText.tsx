import type { ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { localImageUrl, wrapLocalImageLinks } from '../lib/localImage';
import { LocalImage } from './ImageViewer';

/** The text of a node's children, when it is plain text. */
function plainText(children: ReactNode): string {
  return typeof children === 'string' ? children : Array.isArray(children) && children.every((c) => typeof c === 'string') ? children.join('') : '';
}

const components = {
  // Links open nothing: render them as plain text, with a preview when they point at a local image.
  a: ({ children, href }: { children?: ReactNode; href?: string }) => {
    const image = href?.startsWith('cm-img:') ? href : null;
    return (
      <>
        <span className="md-link">{children}</span>
        {image && <LocalImage src={image} alt={plainText(children)} />}
      </>
    );
  },
  img: ({ src, alt }: { src?: string | Blob; alt?: string }) => (typeof src === 'string' && src ? <LocalImage src={src} alt={alt ?? ''} /> : null),
  // A path to a local image written as code also gets a preview.
  code: ({ children, className }: { children?: ReactNode; className?: string }) => {
    const image = className ? null : localImageUrl(plainText(children));
    return (
      <>
        <code className={className}>{children}</code>
        {image && <LocalImage src={image} alt={plainText(children)} />}
      </>
    );
  },
  // A table scrolls sideways inside its own box when it must, so it never widens the text around it.
  table: ({ children }: { children?: ReactNode }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

/** Local image paths and file: links become app addresses; everything else gets the usual safe treatment. */
const urlTransform = (url: string): string => localImageUrl(url) ?? defaultUrlTransform(url);

/** Agent text rendered as GitHub-flavoured markdown. */
export function MarkdownText({ text, className = 'md' }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>{wrapLocalImageLinks(text)}</Markdown>
    </div>
  );
}
