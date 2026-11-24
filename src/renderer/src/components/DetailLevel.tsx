import { CHAT_DETAILS, type ChatDetail } from '../../../shared/contracts';

const NAMES: Record<ChatDetail, string> = { minimal: 'Minimal', moderate: 'Moderat', detailed: 'Detaljerat' };
const SWITCH_TITLES: Record<ChatDetail, string> = {
  minimal: 'Minimal: bara svar, frågor, antaganden, fel, risker och varningar',
  moderate: 'Moderat: även resultat, godkända kontroller, beslut och förslag',
  detailed: 'Detaljerat: allt ofiltrerat, som i Claude Code: varje meddelande utan taggar; bara kommandon fälls ihop',
};

/** One to three dots: how far down a level reaches (one dot shows even in Minimal, three only in Detaljerat). */
export function LevelDots({ level }: { level: ChatDetail }) {
  const filled = CHAT_DETAILS.indexOf(level) + 1;
  return (
    <span className="level-dots" aria-hidden>
      {CHAT_DETAILS.map((d, i) => (
        <span key={d} className={i < filled ? 'on' : undefined} />
      ))}
    </span>
  );
}

/** Where a block shows, for its tooltip: "Syns i Minimal, Moderat och Detaljerat". */
export function levelTitle(level: ChatDetail): string {
  const shows = CHAT_DETAILS.slice(CHAT_DETAILS.indexOf(level)).map((d) => NAMES[d]);
  return `Syns i ${shows.length > 1 ? `${shows.slice(0, -1).join(', ')} och ${shows[shows.length - 1]}` : shows[0]}`;
}

/** A chat's Minimal / Moderat / Detaljerat switch, drawn with the same dots that mark each block. */
export function DetailSwitch({ value, onChange }: { value: ChatDetail; onChange: (detail: ChatDetail) => void }) {
  return (
    <div className="detail-switch" role="radiogroup" aria-label="Detaljnivå i chatten">
      {CHAT_DETAILS.map((d) => (
        <button key={d} type="button" role="radio" aria-checked={value === d} title={SWITCH_TITLES[d]} onClick={() => onChange(d)}>
          <LevelDots level={d} />
        </button>
      ))}
    </div>
  );
}
