import type { Callout, CalloutKind } from '../../../shared/contracts';
import { send } from '../lib/api';
import { CALLOUT_LABEL } from '../lib/format';
import { useContextMenu } from './ContextMenu';
import { MarkdownText } from './MarkdownText';

/** Small line icon per callout kind (stop sign, triangle, exclamation, info, bulb). */
export function CalloutIcon({ kind }: { kind: CalloutKind }) {
  const mark = (y1: number, y2: number, dot: number) => (
    <>
      <line x1="8" y1={y1} x2="8" y2={y2} />
      <circle cx="8" cy={dot} r="0.6" fill="currentColor" />
    </>
  );
  const shape = {
    caution: <><polygon points="5.2,1.2 10.8,1.2 14.8,5.2 14.8,10.8 10.8,14.8 5.2,14.8 1.2,10.8 1.2,5.2" />{mark(4.6, 8.6, 11.2)}</>,
    warning: <><path d="M8 1.6 L14.8 14 H1.2 Z" />{mark(6, 9.6, 11.9)}</>,
    question: <><circle cx="8" cy="8" r="6.6" /><path d="M6.1 6.1 C6.1 4.2 9.9 4.2 9.9 6.2 C9.9 7.6 8 7.6 8 9.2" /><circle cx="8" cy="11.4" r="0.6" fill="currentColor" /></>,
    important: <><circle cx="8" cy="8" r="6.6" />{mark(4.4, 8.6, 11.2)}</>,
    note: <><circle cx="8" cy="8" r="6.6" /><line x1="8" y1="7.2" x2="8" y2="11.4" /><circle cx="8" cy="4.9" r="0.6" fill="currentColor" /></>,
    tip: <><path d="M5.6 10.4 C3.6 9 3.4 5.6 5 4 C6.5 2.4 9.5 2.4 11 4 C12.6 5.6 12.4 9 10.4 10.4 V12 H5.6 Z" /><line x1="6.2" y1="14.2" x2="9.8" y2="14.2" /></>,
  }[kind];
  return (
    <svg className="callout-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      {shape}
    </svg>
  );
}

/** The message "Fixa" sends: the tagged item itself as context, so the agent knows exactly what to fix. */
export function fixRequest(callout: Callout): string {
  const what = [callout.title && `"${callout.title}"`, callout.text].filter(Boolean).join(' – ');
  return `Fixa det här som du flaggade (${CALLOUT_LABEL[callout.kind]}): ${what}`;
}

/**
 * A tagged item: icon, kind label, bold title and short text, coloured by kind. With `sessionId`,
 * right-click offers "Fixa", which sends the item to that session's agent (questions are answered
 * in the message box instead).
 */
export function CalloutBox({ callout, sessionId }: { callout: Callout; sessionId?: string }) {
  const fixable = sessionId !== undefined && callout.kind !== 'question';
  const { open, menu } = useContextMenu(
    fixable ? [{ label: 'Fixa', onSelect: () => send('session:send', { id: sessionId, text: fixRequest(callout) }) }] : [],
  );
  return (
    <div
      className="callout"
      data-kind={callout.kind}
      title={fixable ? 'Högerklicka för att låta agenten fixa det' : undefined}
      onContextMenu={fixable ? open : undefined}
    >
      {menu}
      <CalloutIcon kind={callout.kind} />
      <div className="callout-body">
        <div className="callout-head">
          <span className="callout-label">{CALLOUT_LABEL[callout.kind]}</span>
        </div>
        {callout.title && <div className="callout-title">{callout.title}</div>}
        {callout.text && <MarkdownText text={callout.text} className="md callout-text" />}
      </div>
    </div>
  );
}
