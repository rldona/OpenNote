import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Icon } from './Icon';
import { askText } from './Prompt';
import { api, type Note } from './api';
import { lockNote, type NoteCipher } from './crypto';
import { PassphraseDialog } from './Locked';
import { noteExtensions } from './editorSchema';
import { useRecorder } from './Recorder';
import { Sketch } from './Sketch';
import { t } from './i18n';

type Patch = { title?: string; content?: string };
type Status = 'saved' | 'saving' | 'error';

interface Props {
  note: Note;
  onSaved: (note: Note) => void;
  /** Set when the note was just unlocked: edits are re-encrypted with this key before saving. */
  initialCipher?: NoteCipher | null;
  /** Shown under the title, scrolling with the note (tags, backlinks). */
  aside?: ReactNode;
}

/** Rich text editor with debounced autosave. Remounted per note via `key`. */
export function NoteEditor({ note, onSaved, initialCipher = null, aside }: Props) {
  const [title, setTitle] = useState(note.title);
  const [status, setStatus] = useState<Status>('saved');
  const [picking, setPicking] = useState(false);
  const [askPass, setAskPass] = useState(false);
  const [sketching, setSketching] = useState(false);
  const [cipher, setCipher] = useState<NoteCipher | null>(initialCipher);
  const cipherRef = useRef<NoteCipher | null>(initialCipher);
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editorRef = useRef<Editor | null>(null);
  const readOnly = note.trashedAt !== null;

  const flush = async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    try {
      // Encrypted notes: the plaintext never leaves this window.
      const body = patch.content !== undefined && cipherRef.current ? { ...patch, content: await cipherRef.current.encrypt(patch.content) } : patch;
      const saved = await api.updateNote(note.id, body);
      setStatus('saved');
      onSaved(saved);
    } catch {
      pending.current = { ...patch, ...pending.current };
      setStatus('error');
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const schedule = (patch: Patch) => {
    pending.current = { ...pending.current, ...patch };
    setStatus('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), 600);
  };

  // Don't lose the last keystrokes when switching notes or closing the tab.
  useEffect(() => {
    const onHide = () => void flushRef.current();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      void flushRef.current();
    };
  }, []);

  const insertUpload = async (file: File) => {
    const ed = editorRef.current;
    if (!ed) return;
    const up = await api.upload(note.id, file);
    if (file.type.startsWith('image/')) ed.chain().focus().setImage({ src: up.url, alt: file.name }).run();
    else if (file.type.startsWith('audio/')) ed.chain().focus().insertContent({ type: 'audio', attrs: { src: up.url } }).run();
    else
      ed.chain()
        .focus()
        .insertContent({ type: 'text', text: file.name, marks: [{ type: 'link', attrs: { href: up.url } }] })
        .run();
  };

  const lock = async (passphrase: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    clearTimeout(timer.current);
    delete pending.current.content; // anything still waiting would be saved in the clear
    const { envelope, cipher: c } = await lockNote(ed.getHTML(), passphrase);
    await api.updateNote(note.id, { content: envelope });
    cipherRef.current = c;
    setCipher(c);
    setAskPass(false);
    setStatus('saved');
  };

  const removeLock = async () => {
    const ed = editorRef.current;
    if (!ed) return;
    clearTimeout(timer.current);
    delete pending.current.content;
    await api.updateNote(note.id, { content: ed.getHTML() });
    cipherRef.current = null;
    setCipher(null);
    setStatus('saved');
  };

  const recorder = useRecorder((file) => void insertUpload(file));

  const editor = useEditor({
    editable: !readOnly,
    content: note.content,
    // Links are handled below: internal note links navigate, external ones need Ctrl/Cmd+click.
    extensions: noteExtensions(),
    onUpdate: ({ editor }) => schedule({ content: editor.getHTML() }),
    editorProps: {
      handleDOMEvents: {
        click: (_view, event) => {
          const a = (event.target as HTMLElement).closest('a');
          const href = a?.getAttribute('href');
          if (!href) return false;
          if (href.startsWith('#/note/')) {
            event.preventDefault();
            window.location.hash = href.slice(1);
            return true;
          }
          if (/^(https?:|mailto:)/i.test(href) && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            window.open(href, '_blank', 'noopener,noreferrer');
            return true;
          }
          return false;
        },
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.length) return false;
        files.forEach((f) => void insertUpload(f));
        return true;
      },
      handleDrop: (_view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        files.forEach((f) => void insertUpload(f));
        return true;
      },
    },
  });
  editorRef.current = editor;

  return (
    <div className="editor">
      {!readOnly && editor && <Toolbar editor={editor} onFile={(f) => void insertUpload(f)} onLinkNote={() => setPicking(true)} recorder={recorder} onSketch={() => setSketching(true)} locked={!!cipher} onToggleLock={() => (cipher ? void removeLock() : setAskPass(true))} />}
      {/* The title scrolls with the text; only the toolbar stays put (above the note, or above the keyboard on phones). */}
      <div className="editor-scroll">
      <div className="editor-head">
        <input
          className="title-input"
          value={title}
          placeholder={t('title')}
          readOnly={readOnly}
          onChange={(e) => {
            setTitle(e.target.value);
            schedule({ title: e.target.value });
          }}
        />
        <span className={`status ${status}`} aria-live="polite">
          {status === 'saving' ? t('saving') : status === 'error' ? '⚠' : t('saved')}
        </span>
      </div>
      {aside}
      {cipher && <div className="lock-banner" role="status">🔒 {t('lockedBanner')}</div>}
      {recorder.error && <div className="lock-banner error" role="alert">🎙 {recorder.error}</div>}
      <EditorContent editor={editor} className="editor-body" />
      </div>
      {sketching && (
        <Sketch
          onClose={() => setSketching(false)}
          onDone={(png) => {
            setSketching(false);
            void insertUpload(new File([png], `drawing-${Date.now()}.png`, { type: 'image/png' }));
          }}
        />
      )}
      {askPass && <PassphraseDialog onConfirm={lock} onClose={() => setAskPass(false)} />}
      {picking && editor && (
        <NotePicker
          exclude={note.id}
          onClose={() => setPicking(false)}
          onPick={(n) => {
            setPicking(false);
            const href = `#/note/${n.id}`;
            if (editor.state.selection.empty) {
              editor.chain().focus().insertContent({ type: 'text', text: n.title || t('untitled'), marks: [{ type: 'link', attrs: { href } }] }).run();
            } else {
              editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
            }
          }}
        />
      )}
    </div>
  );
}

function Toolbar({ editor, onFile, onLinkNote, locked, onToggleLock, recorder, onSketch }: {
  editor: Editor;
  onFile: (f: File) => void;
  onLinkNote: () => void;
  locked: boolean;
  onToggleLock: () => void;
  recorder: ReturnType<typeof useRecorder>;
  onSketch: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const dueInput = useRef<HTMLInputElement>(null);
  const chain = () => editor.chain().focus();
  const btn = (label: string, text: ReactNode, run: () => void, active?: boolean) => (
    <button
      key={label}
      type="button"
      className={active ? 'active' : ''}
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {text}
    </button>
  );
  const item = (label: string, icon: ReactNode, run: () => void, close: () => void, active = false) => (
    <button key={label} type="button" role="menuitem" className={active ? 'selected' : ''} onClick={() => { run(); close(); }}>
      <span className="check">{icon}</span>{label}
    </button>
  );
  const heading = editor.isActive('heading') || editor.isActive('blockquote') || editor.isActive('codeBlock');
  // Grouped like the menus of most note apps: text style, inline marks, lists, then what can be inserted.
  return (
    <div className="toolbar" role="toolbar">
      <ToolMenu label={t('textStyle')} icon={<span className="aa">Aa</span>} active={heading || editor.isActive('strike') || editor.isActive('highlight')}>
        {(close) => [
          item(t('paragraph'), '¶', () => chain().setParagraph().run(), close, editor.isActive('paragraph') && !heading),
          item(t('heading1'), 'H1', () => chain().toggleHeading({ level: 1 }).run(), close, editor.isActive('heading', { level: 1 })),
          item(t('heading2'), 'H2', () => chain().toggleHeading({ level: 2 }).run(), close, editor.isActive('heading', { level: 2 })),
          item(t('quote'), '❝', () => chain().toggleBlockquote().run(), close, editor.isActive('blockquote')),
          item(t('code'), '</>', () => chain().toggleCodeBlock().run(), close, editor.isActive('codeBlock')),
          <span key="sep" className="menu-sep" />,
          item(t('strike'), <s>S</s>, () => chain().toggleStrike().run(), close, editor.isActive('strike')),
          item(t('highlight'), '▮', () => chain().toggleHighlight().run(), close, editor.isActive('highlight')),
        ]}
      </ToolMenu>
      {btn(t('bold'), <b>B</b>, () => chain().toggleBold().run(), editor.isActive('bold'))}
      {btn(t('italic'), <i>I</i>, () => chain().toggleItalic().run(), editor.isActive('italic'))}
      {btn(t('underline'), <u>U</u>, () => chain().toggleUnderline().run(), editor.isActive('underline'))}
      <span className="sep" />
      {btn(t('bullets'), '•≡', () => chain().toggleBulletList().run(), editor.isActive('bulletList'))}
      {btn(t('numbers'), '1.', () => chain().toggleOrderedList().run(), editor.isActive('orderedList'))}
      {btn(t('checklist'), '☑', () => chain().toggleTaskList().run(), editor.isActive('taskList'))}
      {btn(
        t('dueDate'),
        <Icon name="calendar" size={16} />,
        () => {
          const input = dueInput.current;
          if (!input || !editor.isActive('taskItem')) return;
          input.value = (editor.getAttributes('taskItem').due as string | null) ?? '';
          input.showPicker?.();
        },
        !!editor.getAttributes('taskItem').due,
      )}
      <input
        ref={dueInput}
        type="date"
        className="due-picker"
        aria-label={t('dueDate')}
        tabIndex={-1}
        onChange={(e) =>
          chain().updateAttributes('taskItem', { due: e.target.value || null }).run()
        }
      />
      <span className="sep" />
      {btn(
        t('link'),
        <Icon name="link" size={16} />,
        async () => {
          const prev = editor.getAttributes('link').href as string | undefined;
          const url = await askText(t('linkPrompt'), prev ?? 'https://');
          if (url === null) return;
          if (url === '') chain().unsetLink().run();
          else chain().extendMarkRange('link').setLink({ href: url }).run();
        },
        editor.isActive('link'),
      )}
      <ToolMenu label={t('insert')} icon={<Icon name="plus" size={16} />}>
        {(close) => [
          item(t('attach'), <Icon name="clip" size={15} />, () => fileInput.current?.click(), close),
          item(t('table'), '▦', () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), close),
          item(t('rule'), '—', () => chain().setHorizontalRule().run(), close),
          item(t('linkNote'), '⛓', onLinkNote, close),
          item(t('record'), <Icon name="mic" size={15} />, () => void recorder.start(), close),
          item(t('sketch'), <Icon name="pencil" size={15} />, onSketch, close),
        ]}
      </ToolMenu>
      {recorder.recording &&
        btn(t('stopRecording'), `⏹ ${Math.floor(recorder.seconds / 60)}:${String(recorder.seconds % 60).padStart(2, '0')}`, () => recorder.stop(), true)}
      <span className="toolbar-gap" />
      {btn(locked ? t('removeLock') : t('lockNote'), locked ? <Icon name="unlock" size={16} /> : <Icon name="lock" size={16} />, onToggleLock, locked)}
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          [...(e.target.files ?? [])].forEach(onFile);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/**
 * A toolbar button with a menu. The menu is placed with fixed coordinates so the toolbar can scroll sideways (phones) without
 * clipping it, and it opens upwards when the toolbar sits low on the screen (above the keyboard).
 */
function ToolMenu({ label, icon, active = false, children }: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [at, setAt] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const down = (e: Event) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setAt(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAt(null);
    };
    const away = () => setAt(null);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', away);
    };
  }, [at]);
  const toggle = () => {
    if (at || !button.current) return setAt(null);
    const r = button.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 240));
    setAt(r.top > window.innerHeight / 2 ? { left, top: 'auto', bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`menu-btn ${active ? 'active' : ''}`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!at}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        {icon}<span className="caret" aria-hidden="true">▾</span>
      </button>
      {at && (
        <div ref={panel} className="popover-panel tool-menu" role="menu" style={at} onMouseDown={(e) => e.preventDefault()}>
          {children(() => setAt(null))}
        </div>
      )}
    </>
  );
}

/** Modal to search and pick a note to link to. */
function NotePicker({ exclude, onPick, onClose }: {
  exclude: string;
  onPick: (n: { id: string; title: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; title: string; snippet: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      api.notes({ q }).then((r) => !cancelled && setResults(r.filter((n) => n.id !== exclude).slice(0, 30)));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, exclude]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={t('linkNote')} onClick={(e) => e.stopPropagation()}>
        <h3>{t('linkNote')}</h3>
        <input autoFocus type="search" value={q} placeholder={t('searchNotes')} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} style={{ width: '100%', marginBottom: 8 }} />
        <ul>
          {results.map((n) => (
            <li key={n.id}>
              <button className="pick" onClick={() => onPick(n)}>
                <strong>{n.title || t('untitled')}</strong>
                <small>{n.snippet}</small>
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onClose}>{t('close')}</button>
      </div>
    </div>
  );
}
