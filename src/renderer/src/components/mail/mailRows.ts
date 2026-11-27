import type { MailCategory, MailItemView, MailOverview } from '../../../../shared/contracts';

export type RowMarkTone = 'action' | 'reply' | 'unjudged' | 'meeting' | 'none';
export interface RowMark { label: string; tone: RowMarkTone; title: string }

/** The clear "needs action" mark of a row in the hover tree. */
export function rowMark(item: Pick<MailItemView, 'category' | 'needsAction' | 'suggestedAction'>): RowMark {
  switch (item.category) {
    case 'action':
      return { label: 'Åtgärd', tone: 'action', title: item.suggestedAction || 'Kräver åtgärd' };
    case 'reply':
      return { label: 'Svara', tone: 'reply', title: item.suggestedAction || 'Väntar på svar' };
    case 'private':
      return { label: 'Ej bedömt', tone: 'unjudged', title: 'Utesluten från Claude enligt din regel, så mejlet är inte bedömt' };
    case 'meeting':
      return { label: 'Möte', tone: 'meeting', title: item.suggestedAction || 'Mötesförfrågan' };
    default:
      return item.needsAction
        ? { label: 'Åtgärd', tone: 'action', title: item.suggestedAction || 'Kräver åtgärd' }
        : { label: '', tone: 'none', title: '' };
  }
}

/** The draft state shown on a row, or null. */
export function draftLabel(item: Pick<MailItemView, 'draft' | 'agent'>): string | null {
  if (item.draft === 'writing') return 'Skriver svar…';
  if (item.draft === 'proposed') return 'Utkast klart';
  if (item.draft === 'failed') return 'Utkastet misslyckades';
  if (item.agent === 'working') return 'Agenten jobbar…';
  return null;
}

/** The agent cannot work on mail that the user's rules keep from Claude. */
export function agentActionsDisabled(item: Pick<MailItemView, 'category'>): boolean {
  return item.category === 'private';
}

/** Footer of the tree: "4 info · 7 skräp/utskick" from the counts of categories that do not need attention. */
export function footerText(counts: MailOverview['counts']): string {
  const n = (c: MailCategory): number => counts[c] ?? 0;
  const parts: string[] = [];
  if (n('info')) parts.push(`${n('info')} info`);
  if (n('meeting')) parts.push(`${n('meeting')} möte${n('meeting') === 1 ? '' : 'n'}`);
  const junk = n('junk') + n('bulk');
  if (junk) parts.push(`${junk} skräp/utskick`);
  return parts.join(' · ');
}

/** Tooltip and tone of the cell from the source status. */
export function sourceHint(source: MailOverview['source']): { state: 'ok' | 'idle' | 'error'; title: string } {
  switch (source.state) {
    case 'connected':
      return { state: 'ok', title: 'Mejl' };
    case 'outlook-not-running':
      return { state: 'idle', title: 'Outlook är inte igång' };
    case 'error':
      return { state: 'error', title: source.message || 'Fel i mejlanslutningen' };
    default:
      return { state: 'idle', title: 'Ansluter till Outlook…' };
  }
}
