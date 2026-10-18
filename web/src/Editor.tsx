import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { api, type Note } from './api';
import { t } from './i18n';

type Patch = { title?: string; content?: string };
type Status = 'saved' | 'saving' | 'error';

interface Props {
  note: Note;
  onSaved: (note: Note) => void;
}

/** Rich text editor with debounced autosave. Remounted per note via `key`. */
export function NoteEditor({ note, onSaved }: Props) {
  const [title, setTitle] = useState(note.title);
  const [status, setStatus] = useState<Status>('saved');
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
      const saved = await api.updateNote(note.id, patch);
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

  const editor = useEditor({
    editable: !readOnly,
    content: note.content,
    extensions: [
      StarterKit,
      Image,
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: '…' }),
    ],
    onUpdate: ({ editor }) => schedule({ content: editor.getHTML() }),
    editorProps: {
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
      {!readOnly && editor && <Toolbar editor={editor} onFile={(f) => void insertUpload(f)} />}
      <EditorContent editor={editor} className="editor-body" />
    </div>
  );
}

function Toolbar({ editor, onFile }: { editor: Editor; onFile: (f: File) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
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
