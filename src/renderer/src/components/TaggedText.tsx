import { QUIET_BLOCK_TAGS, type BlockTag, type TaggedBlock } from '../../../shared/contracts';
import { MarkdownText } from './MarkdownText';

/** The label each tag shows; answers and quiet blocks (plan, progress, background) show none. */
const LABELS: Record<BlockTag, string> = {
  answer: '',
  result: 'Resultat',
  pass: '✓ Godkänt',
  fail: '✕ Fel',
  warning: 'Varning',
  risk: 'Risk',
  question: 'Fråga',
  assumption: 'Antagande',
  decision: 'Beslut',
  next: 'Förslag',
  plan: '',
  progress: '',
  background: '',
};

/** Whether a message holds anything besides narration, so it should not fold away. */
export function hasWeight(blocks: TaggedBlock[] | undefined): boolean {
  return !!blocks?.some((b) => b.tag !== null && !QUIET_BLOCK_TAGS.includes(b.tag));
}

/**
 * The agent's text, block by block as the turn's tags read it: each block marked by what it is (result,
 * passed check, failure, question …), with the label once per run of the same tag; narration is dimmed.
 * Untagged text (before the tags arrive) shows as plain markdown.
 */
export function TaggedText({ text, blocks }: { text: string; blocks?: TaggedBlock[] }) {
  if (!blocks?.length) return <MarkdownText text={text} />;
  return (
    <div className="tagged">
      {blocks.map((b, i) => {
        const label = b.tag ? LABELS[b.tag] : '';
        const repeat = i > 0 && blocks[i - 1]!.tag === b.tag;
        return (
          <div key={i} className="tb" data-tag={b.tag ?? undefined} data-quiet={b.tag && QUIET_BLOCK_TAGS.includes(b.tag) ? 'true' : undefined}>
            {label && !repeat && <div className="tb-label">{label}</div>}
            <MarkdownText text={b.text} />
          </div>
        );
      })}
    </div>
  );
}
