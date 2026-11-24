import { useState, type KeyboardEvent } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { send } from '../lib/api';

/** Commands that are not on the context meter: clear the conversation, or stop the running turn. */
function ActionsMenu({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const sendText = (text: string): void => {
    send('session:send', { id: session.id, text });
    onClose();
  };

  return (
    <div className="menu" onMouseLeave={onClose}>
      <button type="button" onClick={() => sendText('/clear')}>/clear</button>
      {session.status === 'working' && (
        <button type="button" className="danger-text" onClick={() => { send('session:interrupt', { id: session.id }); onClose(); }}>
          Avbryt
        </button>
      )}
    </div>
  );
}

function normalizeCommand(c: string): string {
  return c.startsWith('/') ? c : `/${c}`;
}

/**
 * Message box with slash-command suggestions. The full version (Fokus) also has the actions menu;
 * the compact one-line version sits on overview cards.
 */
export function ChatInput({ session, compact = false }: { session: SessionSummary; compact?: boolean }) {
  const [text, setText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const suggestions =
    text.startsWith('/') && !text.includes(' ')
      ? session.slashCommands.map(normalizeCommand).filter((c) => c.startsWith(text) && c !== text).slice(0, 6)
      : [];

  const busy = session.status === 'working';
  /** Enter sends (it waits while the agent is busy); Ctrl+Enter stops what the agent is doing and has it do this instead. */
  const submit = (redirect = false): void => {
    const value = text.trim();
    if (!value) return;
    if (redirect && busy) send('session:redirect', { id: session.id, text: value });
    else send('session:send', { id: session.id, text: value });
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(e.ctrlKey);
    }
  };

  return (
    <div className={compact ? 'chat-input compact' : 'chat-input'}>
      {suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.map((c) => (
            <button type="button" key={c} onClick={() => setText(`${c} `)}>{c}</button>
          ))}
        </div>
      )}
      <textarea
        rows={compact ? 1 : 2}
        value={text}
        placeholder={
          busy
            ? compact
              ? 'Skriv… (Enter: köa, Ctrl+Enter: avbryt och gör detta)'
              : 'Skriv till agenten… (Enter: läses när den är klar, Ctrl+Enter: avbryt och gör detta i stället)'
            : compact
              ? 'Skriv till agenten… (Enter skickar)'
              : 'Skriv till agenten… (Enter skickar, Skift+Enter ny rad)'
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      {!compact && (
        <div className="chat-input-side">
          <button type="button" className="icon-btn" title="Kommandon" aria-label="Kommandon" onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
          {menuOpen && <ActionsMenu session={session} onClose={() => setMenuOpen(false)} />}
        </div>
      )}
    </div>
  );
}
