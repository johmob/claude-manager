import type { Callout, CalloutKind } from '../../../shared/contracts';
import { CALLOUT_LABEL } from '../lib/format';
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

/** A tagged item: icon, kind label, bold title and short text, coloured by kind. */
export function CalloutBox({ callout }: { callout: Callout }) {
  return (
    <div className="callout" data-kind={callout.kind}>
      <CalloutIcon kind={callout.kind} />
      <div className="callout-body">
        <div className="callout-head">
          <span className="callout-label">{CALLOUT_LABEL[callout.kind]}</span>
          {callout.source === 'review' && <span className="callout-source" title="Från den extra granskningen, inte från agenten själv">granskning</span>}
        </div>
        {callout.title && <div className="callout-title">{callout.title}</div>}
        {callout.text && <MarkdownText text={callout.text} className="md callout-text" />}
      </div>
    </div>
  );
}
