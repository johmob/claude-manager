import { useContext, useState } from 'react';
import { QUIET_BLOCK_TAGS, TAG_LEVEL, tagShows, type BlockTag, type ChatDetail, type TaggedBlock } from '../../../shared/contracts';
import { LevelDots, levelTitle } from './DetailLevel';
import { ChatDetailContext } from '../state/chatDetail';
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

/** Whether a message holds anything worth showing at this detail, so it should not fold away. */
export function hasWeight(blocks: TaggedBlock[] | undefined, detail: ChatDetail): boolean {
  if (detail === 'detailed') return true;
  return !!blocks?.some((b) => b.tag !== null && !QUIET_BLOCK_TAGS.includes(b.tag) && tagShows(b.tag, detail));
}

/**
 * The agent's text, block by block as the turn's tags read it: each block marked by what it is (result,
 * passed check, failure, question …), with the label once per run of the same tag; narration is dimmed.
 * Each block carries one to three dots for the lowest detail it shows at (one: even in Minimal).
 * Blocks below the chat's detail are hidden behind "Visa N stycken till". Detaljerat, and untagged text
 * (before the tags arrive), show as plain markdown.
 */
export function TaggedText({ text, blocks }: { text: string; blocks?: TaggedBlock[] }) {
  const detail = useContext(ChatDetailContext);
  const [all, setAll] = useState(false);
  // Detaljerat is the raw text, untagged; so is text whose tags have not arrived.
  if (!blocks?.length || detail === 'detailed') return <MarkdownText text={text} />;
  const visible = blocks.filter((b) => b.tag === null || tagShows(b.tag, detail));
  const hidden = blocks.length - visible.length;
  const shown = all ? blocks : visible;
  return (
    <div className="tagged">
      {shown.map((b, i) => {
        const label = b.tag ? LABELS[b.tag] : '';
        const repeat = i > 0 && shown[i - 1]!.tag === b.tag;
        return (
          <div key={i} className="tb" data-tag={b.tag ?? undefined} data-quiet={b.tag && QUIET_BLOCK_TAGS.includes(b.tag) ? 'true' : undefined}>
            {b.tag && (
              <span className="tb-level" title={levelTitle(TAG_LEVEL[b.tag])}>
                <LevelDots level={TAG_LEVEL[b.tag]} />
              </span>
            )}
            {label && !repeat && <div className="tb-label">{label}</div>}
            <MarkdownText text={b.text} />
          </div>
        );
      })}
      {hidden > 0 && (
        <button type="button" className="link-btn tb-more" onClick={() => setAll(!all)}>
          {all ? 'Visa mindre' : `Visa ${hidden} ${hidden === 1 ? 'stycke' : 'stycken'} till`}
        </button>
      )}
    </div>
  );
}
