/**
 * The note editor on its own, for the mobile apps (mobile/), which show it in a WebView for the body of a note while the rest
 * of the screen (title, tags, formatting bar) is native. Same schema as the web editor (../editorSchema.ts), so a note is
 * read and saved the same everywhere.
 *
 * Host → page:  window.OpenNoteEditor.load({ html, editable?, placeholder? })
 *               window.OpenNoteEditor.exec(command, arg?)        see COMMANDS
 *               window.OpenNoteEditor.setTheme({ dark, accentHue? })
 *               window.OpenNoteEditor.focus() / .flush()
 * Page → host:  { type: 'ready' }
 *               { type: 'change', html }        debounced 300 ms; also right away on flush()
 *               { type: 'state', state }        what the formatting bar shows (EditorState below)
 *               { type: 'link', href }          the user tapped a link (#/note/<id> or an outside URL)
 * Messages are JSON strings, sent to `window.OpenNoteAndroid.postMessage` (Android), to
 * `window.webkit.messageHandlers.opennote.postMessage` (iOS) or, in a plain browser, to the parent window.
 */
import { Editor } from '@tiptap/core';
import { noteExtensions } from '../editorSchema';
import '../prosemirror.css';
import './embed.css';

type Message =
  | { type: 'ready' }
  | { type: 'change'; html: string }
  | { type: 'state'; state: EditorState }
  | { type: 'link'; href: string };

export interface EditorState {
  bold: boolean; italic: boolean; underline: boolean; strike: boolean; highlight: boolean; link: boolean;
  paragraph: boolean; heading1: boolean; heading2: boolean; blockquote: boolean; codeBlock: boolean;
  bulletList: boolean; orderedList: boolean; taskList: boolean;
  /** The cursor is in a checklist item; `due` is its date (YYYY-MM-DD) if it has one. */
  inTask: boolean; due: string | null;
  canUndo: boolean; canRedo: boolean;
}

declare global {
  interface Window {
    OpenNoteAndroid?: { postMessage(json: string): void };
    webkit?: { messageHandlers?: { opennote?: { postMessage(json: string): void } } };
    OpenNoteEditor: typeof api;
  }
}

function send(msg: Message) {
  const json = JSON.stringify(msg);
  if (window.OpenNoteAndroid) window.OpenNoteAndroid.postMessage(json);
  else if (window.webkit?.messageHandlers?.opennote) window.webkit.messageHandlers.opennote.postMessage(json);
  else window.parent.postMessage(json, '*');
}

let editor: Editor | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastState = '';

/** Sends a change still waiting for its debounce (before switching notes), and nothing otherwise. */
const flushPending = () => {
  if (timer !== undefined) flush();
};

const flush = () => {
  clearTimeout(timer);
  timer = undefined;
  if (editor) send({ type: 'change', html: editor.getHTML() });
};

function state(ed: Editor): EditorState {
  const task = ed.isActive('taskItem');
  return {
    bold: ed.isActive('bold'), italic: ed.isActive('italic'), underline: ed.isActive('underline'), strike: ed.isActive('strike'),
    highlight: ed.isActive('highlight'), link: ed.isActive('link'),
    paragraph: ed.isActive('paragraph'), heading1: ed.isActive('heading', { level: 1 }), heading2: ed.isActive('heading', { level: 2 }),
    blockquote: ed.isActive('blockquote'), codeBlock: ed.isActive('codeBlock'),
    bulletList: ed.isActive('bulletList'), orderedList: ed.isActive('orderedList'), taskList: ed.isActive('taskList'),
    inTask: task, due: task ? ((ed.getAttributes('taskItem').due as string | null) ?? null) : null,
    canUndo: ed.can().undo(), canRedo: ed.can().redo(),
  };
}

function reportState() {
  if (!editor) return;
  const s = state(editor);
  const json = JSON.stringify(s);
  if (json === lastState) return;
  lastState = json;
  send({ type: 'state', state: s });
}

/** Inserted things go after whatever is selected (a picture just added, say) instead of replacing it. */
const afterSelection = (ed: Editor) => ed.chain().focus().setTextSelection(ed.state.selection.to);

/** Everything the native formatting bar can ask for. */
const COMMANDS: Record<string, (ed: Editor, arg?: string) => void> = {
  bold: (ed) => ed.chain().focus().toggleBold().run(),
  italic: (ed) => ed.chain().focus().toggleItalic().run(),
  underline: (ed) => ed.chain().focus().toggleUnderline().run(),
  strike: (ed) => ed.chain().focus().toggleStrike().run(),
  highlight: (ed) => ed.chain().focus().toggleHighlight().run(),
  paragraph: (ed) => ed.chain().focus().setParagraph().run(),
  heading1: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
  heading2: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
  blockquote: (ed) => ed.chain().focus().toggleBlockquote().run(),
  codeBlock: (ed) => ed.chain().focus().toggleCodeBlock().run(),
  bulletList: (ed) => ed.chain().focus().toggleBulletList().run(),
  orderedList: (ed) => ed.chain().focus().toggleOrderedList().run(),
  taskList: (ed) => ed.chain().focus().toggleTaskList().run(),
  /** Nest or un-nest the current list item (checklist items too). */
  indent: (ed) => ed.chain().focus().sinkListItem(ed.isActive('taskItem') ? 'taskItem' : 'listItem').run(),
  outdent: (ed) => ed.chain().focus().liftListItem(ed.isActive('taskItem') ? 'taskItem' : 'listItem').run(),
  /** arg: YYYY-MM-DD, or empty to clear. Only inside a checklist item. */
  due: (ed, arg) => { if (ed.isActive('taskItem')) ed.chain().focus().updateAttributes('taskItem', { due: arg || null }).run(); },
  /** arg: URL, or empty to remove the link. */
  link: (ed, arg) => (arg ? ed.chain().focus().extendMarkRange('link').setLink({ href: arg }).run() : ed.chain().focus().unsetLink().run()),
  /** arg: JSON {"id","title"}. Links the selection, or inserts the title as a link. */
  noteLink: (ed, arg) => {
    const { id, title } = JSON.parse(arg ?? '{}') as { id?: string; title?: string };
    if (!id) return;
    const href = `#/note/${id}`;
    if (ed.state.selection.empty) ed.chain().focus().insertContent({ type: 'text', text: title || id, marks: [{ type: 'link', attrs: { href } }] }).run();
    else ed.chain().focus().extendMarkRange('link').setLink({ href }).run();
  },
  table: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  rule: (ed) => ed.chain().focus().setHorizontalRule().run(),
  /** arg: src (/api/attachments/<id>). */
  image: (ed, arg) => { if (arg) afterSelection(ed).setImage({ src: arg }).run(); },
  audio: (ed, arg) => { if (arg) afterSelection(ed).insertContent({ type: 'audio', attrs: { src: arg } }).run(); },
  /** arg: JSON {"href","name"}: a file attachment as a link. */
  file: (ed, arg) => {
    const { href, name } = JSON.parse(arg ?? '{}') as { href?: string; name?: string };
    if (href) afterSelection(ed).insertContent({ type: 'text', text: name || href, marks: [{ type: 'link', attrs: { href } }] }).run();
  },
  undo: (ed) => ed.chain().focus().undo().run(),
  redo: (ed) => ed.chain().focus().redo().run(),
};

const api = {
  load({ html, editable = true, placeholder = '…' }: { html: string; editable?: boolean; placeholder?: string }) {
    // The page (and the WebView) stays loaded between notes; only the editor is rebuilt, so opening a note is quick and the
    // undo history of one note never reaches the next.
    flushPending();
    editor?.destroy();
    editor = new Editor({
      element: document.getElementById('editor')!,
      extensions: noteExtensions(placeholder),
      editable,
      content: html,
      onUpdate: () => {
        clearTimeout(timer);
        timer = setTimeout(flush, 300);
      },
      onTransaction: reportState,
      onSelectionUpdate: reportState,
      editorProps: {
        handleDOMEvents: {
          click: (_view, event) => {
            const href = (event.target as HTMLElement).closest('a')?.getAttribute('href');
            if (!href) return false;
            event.preventDefault();
            send({ type: 'link', href });
            return true;
          },
        },
      },
    });
    lastState = '';
    reportState();
  },
  exec(command: string, arg?: string) {
    if (editor && COMMANDS[command]) COMMANDS[command](editor, arg);
  },
  focus() {
    editor?.commands.focus('end');
  },
  flush,
  setTheme({ dark, accentHue }: { dark: boolean; accentHue?: number }) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (accentHue !== undefined) document.documentElement.style.setProperty('--accent-h', String(accentHue));
  },
};

window.OpenNoteEditor = api;
window.addEventListener('pagehide', flush);
send({ type: 'ready' });
