import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { api, type Note } from './api';
import { lockNote, type NoteCipher } from './crypto';
import { PassphraseDialog } from './Locked';
import { t } from './i18n';

/** Checklist item that can carry a due date, stored as data-due="YYYY-MM-DD". */
const DueTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      due: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-due'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.due ? { 'data-due': attrs.due as string } : {}),
      },
    };
  },
});

type Patch = { title?: string; content?: string };
type Status = 'saved' | 'saving' | 'error';

interface Props {
  note: Note;
  onSaved: (note: Note) => void;
  /** Set when the note was just unlocked: edits are re-encrypted with this key before saving. */
  initialCipher?: NoteCipher | null;
}

/** Rich text editor with debounced autosave. Remounted per note via `key`. */
export function NoteEditor({ note, onSaved, initialCipher = null }: Props) {
  const [title, setTitle] = useState(note.title);
  const [status, setStatus] = useState<Status>('saved');
  const [picking, setPicking] = useState(false);
  const [askPass, setAskPass] = useState(false);
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

  const editor = useEditor({
    editable: !readOnly,
    content: note.content,
    extensions: [
      // Links are handled below: internal note links navigate, external ones need Ctrl/Cmd+click.
      StarterKit.configure({ link: { openOnClick: false } }),
      Image,
      Highlight,
      TaskList,
      DueTaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: '…' }),
    ],
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
      {!readOnly && editor && <Toolbar editor={editor} onFile={(f) => void insertUpload(f)} onLinkNote={() => setPicking(true)} locked={!!cipher} onToggleLock={() => (cipher ? void removeLock() : setAskPass(true))} />}
      {cipher && <div className="lock-banner" role="status">🔒 {t('lockedBanner')}</div>}
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
      <EditorContent editor={editor} className="editor-body" />
    </div>
  );
}

function Toolbar({ editor, onFile, onLinkNote, locked, onToggleLock }: {
  editor: Editor;
  onFile: (f: File) => void;
  onLinkNote: () => void;
  locked: boolean;
  onToggleLock: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const dueInput = useRef<HTMLInputElement>(null);
  const chain = () => editor.chain().focus();
  const btn = (label: string, text: string, run: () => void, active?: boolean) => (
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
  return (
    <div className="toolbar" role="toolbar">
      {btn(t('bold'), 'B', () => chain().toggleBold().run(), editor.isActive('bold'))}
      {btn(t('italic'), 'I', () => chain().toggleItalic().run(), editor.isActive('italic'))}
      {btn(t('underline'), 'U', () => chain().toggleUnderline().run(), editor.isActive('underline'))}
      {btn(t('strike'), 'S', () => chain().toggleStrike().run(), editor.isActive('strike'))}
      {btn(t('highlight'), '▮', () => chain().toggleHighlight().run(), editor.isActive('highlight'))}
      <span className="sep" />
      {btn('H1', 'H1', () => chain().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
      {btn('H2', 'H2', () => chain().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
      <span className="sep" />
      {btn(t('bullets'), '•≡', () => chain().toggleBulletList().run(), editor.isActive('bulletList'))}
      {btn(t('numbers'), '1.', () => chain().toggleOrderedList().run(), editor.isActive('orderedList'))}
      {btn(t('checklist'), '☑', () => chain().toggleTaskList().run(), editor.isActive('taskList'))}
      {btn(
        t('dueDate'),
        '📅',
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
      {btn(t('quote'), '❝', () => chain().toggleBlockquote().run(), editor.isActive('blockquote'))}
      {btn(t('code'), '</>', () => chain().toggleCodeBlock().run(), editor.isActive('codeBlock'))}
      <span className="sep" />
      {btn(t('table'), '▦', () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      {btn(t('rule'), '—', () => chain().setHorizontalRule().run())}
      {btn(
        t('link'),
        '🔗',
        () => {
          const prev = editor.getAttributes('link').href as string | undefined;
          const url = window.prompt(t('linkPrompt'), prev ?? 'https://');
          if (url === null) return;
          if (url === '') chain().unsetLink().run();
          else chain().extendMarkRange('link').setLink({ href: url }).run();
        },
        editor.isActive('link'),
      )}
      {btn(t('linkNote'), '⛓', onLinkNote)}
      {btn(locked ? t('removeLock') : t('lockNote'), locked ? '🔓' : '🔒', onToggleLock, locked)}
      {btn(t('attach'), '📎', () => fileInput.current?.click())}
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
