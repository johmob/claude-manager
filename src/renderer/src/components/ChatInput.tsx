import { useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { SessionSummary } from '../../../shared/contracts';
import { PASTE_FILE_MAX_BYTES, PASTE_MAX_BYTES, PASTE_TYPES, withAttachments } from '../../../shared/pastedImages';
import { errorMessage, send } from '../lib/api';
import { baseName } from '../lib/fileShare';
import { localImageUrl } from '../lib/localImage';
import { useVoice, type VoiceText } from '../state/useVoice';
import '../styles/attach.css';
import '../styles/chat-input.css';
import { CompactButton } from './CompactButton';
import { MicButton, type VoiceApi } from './MicButton';

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
  /** After a cleaned-up dictation: what the box got and what was actually said, until the user edits or sends. */
  const [spoken, setSpoken] = useState<{ cleaned: string; raw: string } | null>(null);
  const voice = useVoice();
  /** What the last transcription heard, so the text that comes back from the mic can be paired with its original. */
  const lastVoice = useRef<VoiceText | null>(null);
  const caretAfter = useRef<number | null>(null);
  const micApi: VoiceApi = {
    status: voice.status,
    prepare: voice.prepare,
    transcribe: async (wav) => {
      const heard = await voice.transcribe(wav);
      lastVoice.current = heard;
      return heard.text;
    },
  };

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
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const fit = (): void => {
      el.style.height = 'auto';
      const host = el.closest('.tile, .card');
      const max = compact ? 6 * 18 + 12 : (host?.clientHeight || window.innerHeight) / 2;
      el.style.height = `${Math.min(el.scrollHeight, max)}px`;
      el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [text, compact]);
  /** Enter sends (it waits while the agent is busy); Ctrl+Enter stops what the agent is doing and has it do this instead. */
  const submit = (redirect = false, override?: string): void => {
    const value = withAttachments(override ?? text, images.map((i) => i.path), files.map((f) => f.path));
    if (!value) return;
    if (redirect && busy) send('session:redirect', { id: session.id, text: value });
    else send('session:send', { id: session.id, text: value });
    setText('');
    setImages([]);
    setFiles([]);
    setProblem('');
    setSpoken(null);
  };
  /** Puts dictated text into the box at the cursor, with a space on either side where needed, and leaves the caret after it. */
  const insertSpoken = (piece: string): void => {
    const el = areaRef.current;
    const from = Math.min(el?.selectionStart ?? text.length, text.length);
    const to = Math.min(Math.max(el?.selectionEnd ?? from, from), text.length);
    const before = text.slice(0, from);
    const after = text.slice(to);
    const lead = before && !/s$/.test(before) ? ' ' : '';
    const tail = after && !/^s/.test(after) ? ' ' : '';
    caretAfter.current = (before + lead + piece).length;
    setText(before + lead + piece + tail + after);
  };
  /**
   * Dictated text. It goes straight to the agent only when the user asked for that, nothing cleaned it up, and
   * the box is empty (never send something they have not seen); otherwise it goes into the box.
   */
  const onSpoken = (said: string): void => {
    const heard = lastVoice.current;
    const cleaned = heard !== null && heard.text === said && heard.raw !== heard.text;
    if (voice.autoSend && !voice.cleanup && !text.trim() && images.length === 0 && files.length === 0) return submit(false, said);
    insertSpoken(said);
    setSpoken(cleaned && heard ? { cleaned: said, raw: heard.raw } : null);
  };
  const showOriginal = (): void => {
    if (!spoken) return;
    const at = text.indexOf(spoken.cleaned);
    if (at >= 0) {
      caretAfter.current = at + spoken.raw.length;
      setText(text.slice(0, at) + spoken.raw + text.slice(at + spoken.cleaned.length));
    }
    setSpoken(null);
  };
  useLayoutEffect(() => {
    const at = caretAfter.current;
    const el = areaRef.current;
    if (at === null || !el) return;
    caretAfter.current = null;
    el.focus();
    el.setSelectionRange(at, at);
  }, [text]);
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
        ref={areaRef}
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
        onChange={(e) => {
          setText(e.target.value);
          setSpoken(null);
        }}
        onKeyDown={onKey}
        onPaste={onPaste}
        enterKeyHint="send"
      />
      {compact && <MicButton voice={micApi} silenceSeconds={voice.silenceSeconds} onText={onSpoken} compact />}
      {!compact && (
        <div className="chat-input-side">
          <MicButton voice={micApi} silenceSeconds={voice.silenceSeconds} onText={onSpoken} />
          <button type="button" className="icon-btn" title="Kommandon" aria-label="Kommandon" onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
          <CompactButton session={session} />
          {menuOpen && <ActionsMenu session={session} onClose={() => setMenuOpen(false)} />}
        </div>
      )}
      {spoken && (
        <div className="voice-original">
          Städat talspråk.
          <button type="button" className="link-btn" onClick={showOriginal}>Visa originalet</button>
        </div>
      )}
    </div>
  );
}
