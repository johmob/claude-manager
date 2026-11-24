import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { imagePathOf, isLocalPath, localImageUrl, wrapLocalImageLinks } from '../lib/localImage';
import { send } from '../lib/api';
import { FileLink } from './FileLink';
import { LocalImage, showImage } from './ImageViewer';

/** The text of a node's children, when it is plain text. */
function plainText(children: ReactNode): string {
  return typeof children === 'string' ? children : Array.isArray(children) && children.every((c) => typeof c === 'string') ? children.join('') : '';
}

const components = {
  // Links open outside the app (web links in the browser, files and folders in Windows); local images
  // also get a preview and open in the app's image viewer.
  a: ({ children, href }: { children?: ReactNode; href?: string }) => {
    const image = href?.startsWith('cm-img:') ? href : null;
    // Local files (and images) get the file actions: right-click on the computer, a download sheet on the phone.
    if (image)
      return (
        <>
          <FileLink href={image} path={imagePathOf(image)} onOpen={() => showImage(image, plainText(children))}>{children}</FileLink>
          <LocalImage src={image} alt={plainText(children)} />
        </>
      );
    if (href && isLocalPath(href)) return <FileLink href={href}>{children}</FileLink>;
    return (
      <a
        className="md-link"
        href={href}
        title={href ? decodeLink(href) : undefined}
        onClick={(e) => {
          e.preventDefault();
          if (href) send('shell:open', { target: href });
        }}
      >
        {children}
      </a>
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
  // A table in its own box: a normal table where there is room, one card per row where there is not
  // (each cell then carries its column's heading, see labelCells).
  table: ({ children }: { children?: ReactNode }) => (
    <div className="md-table">
      <table>{labelCells(children)}</table>
    </div>
  ),
};

type WithChildren = ReactElement<{ children?: ReactNode }>;

/** Gives every body cell its column's heading as data-label, so a narrow table can show it per row. */
function labelCells(children: ReactNode): ReactNode {
  const parts = Children.toArray(children).filter(isValidElement) as WithChildren[];
  const head = parts.find((p) => p.type === 'thead');
  const headings = head
    ? (Children.toArray((Children.toArray(head.props.children).find(isValidElement) as WithChildren | undefined)?.props.children).filter(isValidElement) as WithChildren[]).map((th) => textOf(th.props.children))
    : [];
  return parts.map((part) =>
    part.type !== 'tbody'
      ? part
      : cloneElement(part, {
          children: (Children.toArray(part.props.children).filter(isValidElement) as WithChildren[]).map((tr) =>
            cloneElement(tr, {
              children: (Children.toArray(tr.props.children).filter(isValidElement) as WithChildren[]).map((td, i) =>
                cloneElement(td as ReactElement<Record<string, unknown>>, { 'data-label': headings[i] ?? '' }),
              ),
            }),
          ),
        }),
  );
}

/** The plain text inside some rendered markdown. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node as WithChildren).props.children);
  return '';
}

/** Local image paths and file: links become app addresses; everything else gets the usual safe treatment. */
const urlTransform = (url: string): string => localImageUrl(url) ?? (isLocalPath(url) ? url : defaultUrlTransform(url));

/** A link target as the user would read it (local paths arrive percent-encoded). */
function decodeLink(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** Agent text rendered as GitHub-flavoured markdown. */
export function MarkdownText({ text, className = 'md' }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>{wrapLocalImageLinks(text)}</Markdown>
    </div>
  );
}
