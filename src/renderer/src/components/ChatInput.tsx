import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { PASTE_MAX_BYTES, PASTE_TYPES, withImages } from '../../../shared/pastedImages';
import { errorMessage, send } from '../lib/api';
import { isRemote } from '../lib/platform';
import { shrinkImage } from '../lib/shrinkImage';

interface Attached {
  path: string;
  preview: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

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
  const [images, setImages] = useState<Attached[]>([]);
  const [problem, setProblem] = useState('');
  /** On the phone: Enter is a new line (the soft keyboard has no Ctrl), buttons send, and photos come from the camera or gallery. */
  const touch = isRemote && !compact;
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  /** Saves pasted or dropped image files through main and shows them as thumbnails until the message is sent. */
  const attach = async (files: File[]): Promise<void> => {
    setProblem('');
    for (const original of files) {
      const file = isRemote ? await shrinkImage(original) : original;
      if (!PASTE_TYPES[file.type]) continue;
      if (file.size > PASTE_MAX_BYTES) {
        setProblem('Bilden är större än 5 MB.');
        continue;
      }
      try {
        const preview = await readAsDataUrl(file);
        const path = await window.cm.invoke('session:paste-image', { id: session.id, mime: file.type, data: preview.slice(preview.indexOf(',') + 1) });
        setImages((prev) => [...prev, { path, preview }]);
      } catch (e) {
        setProblem(errorMessage(e));
      }
    }
  };
  const imageFiles = (items: DataTransfer | null): File[] => [...(items?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = imageFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    void attach(files);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    const files = imageFiles(e.dataTransfer);
    if (files.length === 0) return;
    e.preventDefault();
    void attach(files);
  };

  const suggestions =
    text.startsWith('/') && !text.includes(' ')
      ? session.slashCommands.map(normalizeCommand).filter((c) => c.startsWith(text) && c !== text).slice(0, 6)
      : [];

  const busy = session.status === 'working';
  /** Enter sends (it waits while the agent is busy); Ctrl+Enter stops what the agent is doing and has it do this instead. */
  const submit = (redirect = false): void => {
    const value = withImages(text, images.map((i) => i.path));
    if (!value) return;
    if (redirect && busy) send('session:redirect', { id: session.id, text: value });
    else send('session:send', { id: session.id, text: value });
    setText('');
    setImages([]);
    setProblem('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!touch && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(e.ctrlKey);
    }
  };

  return (
    <div className={compact ? 'chat-input compact' : touch ? 'chat-input touch' : 'chat-input'} onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={onDrop}>
      {(images.length > 0 || problem) && (
        <div className="paste-strip">
          {images.map((img) => (
            <span className="paste-thumb" key={img.path}>
              <img src={img.preview} alt="Inklistrad bild" />
              <button type="button" aria-label="Ta bort bilden" title="Ta bort bilden" onClick={() => setImages((prev) => prev.filter((i) => i !== img))}>×</button>
            </span>
          ))}
          {problem && <span className="paste-problem">{problem}</span>}
        </div>
      )}
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
          touch
            ? 'Skriv till agenten…'
            : busy
            ? compact
              ? 'Skriv… (Enter: köa, Ctrl+Enter: avbryt och gör detta)'
              : 'Skriv till agenten… (Enter: läses när den är klar, Ctrl+Enter: avbryt och gör detta i stället)'
            : compact
              ? 'Skriv till agenten… (Enter skickar)'
              : 'Skriv till agenten… (Enter skickar, Skift+Enter ny rad)'
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
        enterKeyHint={touch ? 'enter' : 'send'}
      />
      {touch && (
        <div className="chat-touch-bar">
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <button type="button" className="touch-btn" aria-label="Ta ett foto" onClick={() => camera.current?.click()}>Foto</button>
          <button type="button" className="touch-btn" aria-label="Välj bild från galleriet" onClick={() => gallery.current?.click()}>Bild</button>
          <span className="spacer" />
          {busy && <button type="button" className="touch-btn" disabled={!text.trim() && images.length === 0} onClick={() => submit(true)}>Avbryt och gör detta i stället</button>}
          {busy && <button type="button" className="touch-btn danger" onClick={() => send('session:interrupt', { id: session.id })}>Avbryt</button>}
          <button type="button" className="touch-btn primary" disabled={!text.trim() && images.length === 0} onClick={() => submit()}>{busy ? 'Köa' : 'Skicka'}</button>
        </div>
      )}
      {!compact && !touch && (
        <div className="chat-input-side">
          <button type="button" className="icon-btn" title="Kommandon" aria-label="Kommandon" onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
          {menuOpen && <ActionsMenu session={session} onClose={() => setMenuOpen(false)} />}
        </div>
      )}
    </div>
  );
}
