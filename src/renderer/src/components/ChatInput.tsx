import { useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { PASTE_FILE_MAX_BYTES, PASTE_MAX_BYTES, PASTE_TYPES, withAttachments } from '../../../shared/pastedImages';
import { errorMessage, send } from '../lib/api';
import { baseName } from '../lib/fileShare';
import { localImageUrl } from '../lib/localImage';
import '../styles/attach.css';

interface Attached {
  path: string;
  preview: string;
}

interface AttachedFile {
  path: string;
  name: string;
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
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState('');

  /** Adds a file that already lies on disk (dragged from Explorer): images get a thumbnail, anything else a chip. */
  const attachPath = (path: string): void => {
    const norm = path.split('\\').join('/');
    const url = localImageUrl(norm);
    if (url) setImages((prev) => (prev.some((i) => i.path === norm) ? prev : [...prev, { path: norm, preview: url }]));
    else setFiles((prev) => (prev.some((f) => f.path === norm) ? prev : [...prev, { path: norm, name: baseName(norm) }]));
  };

  /** Attaches pasted or dropped files: by path when the file is on disk, otherwise a copy is saved through main. */
  const attach = async (list: File[]): Promise<void> => {
    setProblem('');
    for (const original of list) {
      const path = window.cm.pathForFile?.(original) ?? '';
      if (path) {
        attachPath(path);
        continue;
      }
      try {
        const file = original;
        if (PASTE_TYPES[file.type]) {
          if (file.size > PASTE_MAX_BYTES) {
            setProblem('Bilden är större än 5 MB.');
            continue;
          }
          const preview = await readAsDataUrl(file);
          const saved = await window.cm.invoke('session:paste-image', { id: session.id, mime: file.type, data: preview.slice(preview.indexOf(',') + 1) });
          setImages((prev) => [...prev, { path: saved, preview }]);
        } else {
          if (original.size > PASTE_FILE_MAX_BYTES) {
            setProblem(`${original.name || 'Filen'} är större än 10 MB.`);
            continue;
          }
          const data = (await readAsDataUrl(original)).split(',')[1] ?? '';
          const saved = await window.cm.invoke('session:paste-file', { id: session.id, name: original.name || 'fil', data });
          setFiles((prev) => [...prev, { path: saved, name: original.name || baseName(saved) }]);
        }
      } catch (e) {
        setProblem(errorMessage(e));
      }
    }
  };
  const droppedFiles = (items: DataTransfer | null): File[] => [...(items?.files ?? [])];
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const list = droppedFiles(e.clipboardData);
    if (list.length === 0) return;
    e.preventDefault();
    void attach(list);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    setDragging(false);
    const list = droppedFiles(e.dataTransfer);
    if (list.length === 0) return;
    e.preventDefault();
    void attach(list);
  };

  const suggestions =
    text.startsWith('/') && !text.includes(' ')
      ? session.slashCommands.map(normalizeCommand).filter((c) => c.startsWith(text) && c !== text).slice(0, 6)
      : [];

  const busy = session.status === 'working';
  /** Enter sends (it waits while the agent is busy); Ctrl+Enter stops what the agent is doing and has it do this instead. */
  const submit = (redirect = false): void => {
    const value = withAttachments(text, images.map((i) => i.path), files.map((f) => f.path));
    if (!value) return;
    if (redirect && busy) send('session:redirect', { id: session.id, text: value });
    else send('session:send', { id: session.id, text: value });
    setText('');
    setImages([]);
    setFiles([]);
    setProblem('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(e.ctrlKey);
    }
  };

  return (
    <div className={compact ? 'chat-input compact' : 'chat-input'} data-drag={dragging || undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
      onDrop={onDrop}
    >
      {(images.length > 0 || files.length > 0 || problem) && (
        <div className="paste-strip">
          {images.map((img) => (
            <span className="paste-thumb" key={img.path}>
              <img src={img.preview} alt="Inklistrad bild" />
              <button type="button" aria-label="Ta bort bilden" title="Ta bort bilden" onClick={() => setImages((prev) => prev.filter((i) => i !== img))}>×</button>
            </span>
          ))}
          {files.map((f) => (
            <span className="attach-chip" key={f.path} title={f.path}>
              <span className="attach-chip-name">{f.name}</span>
              <button type="button" aria-label="Ta bort filen" title="Ta bort filen" onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}>×</button>
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
        onPaste={onPaste}
        enterKeyHint="send"
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
