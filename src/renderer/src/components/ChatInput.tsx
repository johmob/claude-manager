import { useState, type KeyboardEvent } from 'react';
import { MODEL_CHOICES, type SessionSummary } from '../../../shared/contracts';
import { MODEL_LABEL, formatTokens } from '../lib/format';
import { errorMessage, send } from '../lib/api';

function ActionsMenu({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const [submenu, setSubmenu] = useState(false);
  const [context, setContext] = useState<string | null>(null);

  const sendText = (text: string): void => {
    send('session:send', { id: session.id, text });
    onClose();
  };
  const showContext = (): void => {
    setContext('Hämtar…');
    window.cm
      .invoke('session:context-usage', { id: session.id })
      .then((u) =>
        setContext(u ? `Kontext: ${Math.round(u.percentage)} % (${formatTokens(u.totalTokens)} / ${formatTokens(u.maxTokens)})` : 'Kontext: ingen data'),
      )
      .catch((e: unknown) => setContext(errorMessage(e)));
  };

  return (
    <div className="menu" onMouseLeave={onClose}>
      <button type="button" onClick={() => sendText('/compact')}>/compact</button>
      <button type="button" onClick={() => sendText('/clear')}>/clear</button>
      <button type="button" onClick={() => setSubmenu(!submenu)}>Byt modell ›</button>
      {submenu &&
        MODEL_CHOICES.map((m) => (
          <button
            type="button"
            key={m}
            className={m === session.model ? 'sub selected' : 'sub'}
            onClick={() => {
              send('session:set-model', { id: session.id, model: m });
              onClose();
            }}
          >
            {MODEL_LABEL[m]}
          </button>
        ))}
      <button type="button" onClick={showContext}>Kontext</button>
      {context && <div className="popover">{context}</div>}
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

/** Message box with slash-command suggestions and a small actions menu. */
export function ChatInput({ session }: { session: SessionSummary }) {
  const [text, setText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const suggestions =
    text.startsWith('/') && !text.includes(' ')
      ? session.slashCommands.map(normalizeCommand).filter((c) => c.startsWith(text) && c !== text).slice(0, 6)
      : [];

  const submit = (): void => {
    const value = text.trim();
    if (!value) return;
    send('session:send', { id: session.id, text: value });
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat-input">
      {suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.map((c) => (
            <button type="button" key={c} onClick={() => setText(`${c} `)}>{c}</button>
          ))}
        </div>
      )}
      <textarea
        rows={2}
        value={text}
        placeholder="Skriv till agenten… (Enter skickar, Skift+Enter ny rad)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <div className="chat-input-side">
        <button type="button" className="icon-btn" title="Kommandon" aria-label="Kommandon" onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
        {menuOpen && <ActionsMenu session={session} onClose={() => setMenuOpen(false)} />}
      </div>
    </div>
  );
}
