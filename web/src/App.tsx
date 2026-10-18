import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Task, type Note, type NoteSummary, type Notebook, type SavedSearch, type TagCount, type Version } from './api';
import { NoteEditor } from './Editor';
import { SyncPanel } from './SyncPanel';
import { locale, t } from './i18n';

type View =
  | { kind: 'all' }
  | { kind: 'pinned' }
  | { kind: 'reminders' }
  | { kind: 'tasks' }
  | { kind: 'trash' }
  | { kind: 'notebook'; id: string }
  | { kind: 'tag'; name: string };

const same = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

const toLocalInput = (ms: number | null) => {
  if (!ms) return '';
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

export function App() {
  const [view, setView] = useState<View>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskStatus, setTaskStatus] = useState<'open' | 'done'>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [rev, setRev] = useState(0);
  const [templates, setTemplates] = useState<NoteSummary[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [backlinks, setBacklinks] = useState<{ id: string; title: string }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [history, setHistory] = useState<Version[] | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const importFilesInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  const refreshMeta = useCallback(async () => {
    const [nb, tg, ss] = await Promise.all([api.notebooks(), api.tags(), api.searches()]);
    setNotebooks(nb);
    setTags(tg);
    setSearches(ss);
    setTemplates(await api.templates());
  }, []);

  const refreshList = useCallback(async () => {
    if (view.kind === 'tasks') {
      setTasks(await api.tasks(taskStatus));
      return;
    }
    setNotes(
      await api.notes({
        q: debouncedQuery,
        notebook: view.kind === 'notebook' ? view.id : undefined,
        tag: view.kind === 'tag' ? view.name : undefined,
        trashed: view.kind === 'trash',
        pinned: view.kind === 'pinned',
        reminders: view.kind === 'reminders',
      }),
    );
  }, [view, debouncedQuery, taskStatus]);

  useEffect(() => void refreshMeta(), [refreshMeta]);
  useEffect(() => void refreshList(), [refreshList]);

  useEffect(() => {
    if (!selectedId) return setNote(null);
    let cancelled = false;
    api.note(selectedId).then((n) => !cancelled && setNote(n)).catch(() => !cancelled && setSelectedId(null));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // In-app reminders (and desktop notifications when permitted).
  useEffect(() => {
    const check = async () => {
      const due = (await api.notes({ reminders: true })).filter((n) => n.reminderAt && n.reminderAt <= Date.now());
      const seen: string[] = JSON.parse(localStorage.getItem('opennote.notified') ?? '[]');
      for (const n of due) {
        const key = `${n.id}:${n.reminderAt}`;
        if (seen.includes(key)) continue;
        seen.push(key);
        setToast(`${t('reminderDue')}: ${n.title || t('untitled')}`);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(n.title || t('untitled'));
        }
      }
      localStorage.setItem('opennote.notified', JSON.stringify(seen.slice(-200)));
    };
    void check();
    const id = setInterval(() => void check(), 30_000);
    return () => clearInterval(id);
  }, []);

  // Internal links look like #/note/<id>.
  useEffect(() => {
    const go = () => {
      const m = /^#\/note\/([\w-]+)$/.exec(window.location.hash);
      if (m) setSelectedId(m[1]!);
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);

  useEffect(() => {
    if (!selectedId) return setBacklinks([]);
    let cancelled = false;
    api.backlinks(selectedId).then((b) => !cancelled && setBacklinks(b)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, rev, note?.updatedAt]);

  const select = (id: string | null) => {
    setSelectedId(id);
    setHistory(null);
  };

  const createNote = async () => {
    const created = await api.createNote({ notebookId: view.kind === 'notebook' ? view.id : undefined, tags: view.kind === 'tag' ? [view.name] : undefined });
    if (view.kind === 'trash') setView({ kind: 'all' });
    await Promise.all([refreshList(), refreshMeta()]);
    select(created.id);
  };

  const onSaved = (saved: Note) => {
    setNote((cur) => (cur && cur.id === saved.id ? { ...cur, ...saved, content: cur.content } : cur));
    void refreshList();
    void refreshMeta();
  };

  const patchNote = async (patch: Partial<Note>) => {
    if (!note) return;
    const saved = await api.updateNote(note.id, patch);
    setNote(saved);
    void refreshList();
    void refreshMeta();
  };

  const afterRemoval = async () => {
    select(null);
    await Promise.all([refreshList(), refreshMeta()]);
  };

  const title = useMemo(() => {
    switch (view.kind) {
      case 'all': return t('allNotes');
      case 'pinned': return t('pinned');
      case 'reminders': return t('reminders');
      case 'tasks': return t('tasks');
      case 'trash': return t('trash');
      case 'notebook': return notebooks.find((n) => n.id === view.id)?.name ?? '';
      case 'tag': return `# ${view.name}`;
    }
  }, [view, notebooks]);

  const stacks = useMemo(() => {
    const map = new Map<string, Notebook[]>();
    for (const nb of notebooks) map.set(nb.stack ?? '', [...(map.get(nb.stack ?? '') ?? []), nb]);
    return [...map.entries()];
  }, [notebooks]);

  const navItem = (
    v: View,
    label: string,
    count?: number,
    extra?: React.ReactNode,
    indent = 0,
    toggle?: React.ReactNode,
  ) => (
    <div className={`nav-item ${same(view, v) ? 'active' : ''}`} key={JSON.stringify(v)} style={{ paddingLeft: indent * 14 }}>
      {toggle}
      <button className="nav-label" onClick={() => { setView(v); select(null); }}>
        <span>{label}</span>
        {count !== undefined && <span className="count">{count}</span>}
      </button>
      {extra}
    </div>
  );

  const nbActions = (nb: Notebook) => (
    <span className="row-actions">
      <button
        title={t('rename')}
        aria-label={`${t('rename')} ${nb.name}`}
        onClick={async () => {
          const name = window.prompt(t('notebookName'), nb.name);
          if (name?.trim()) { await api.updateNotebook(nb.id, { name }); void refreshMeta(); }
        }}
      >✎</button>
      <button
        title={t('delete')}
        aria-label={`${t('delete')} ${nb.name}`}
        disabled={notebooks.length < 2}
        onClick={async () => {
          if (!window.confirm(t('confirmNotebook'))) return;
          await api.deleteNotebook(nb.id);
          if (view.kind === 'notebook' && view.id === nb.id) setView({ kind: 'all' });
          await Promise.all([refreshMeta(), refreshList()]);
        }}
      >✕</button>
    </span>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">OpenNote</div>
        <button className="primary new-note" onClick={() => void createNote()}>＋ {t('newNote')}</button>
        {templates.length > 0 && (
          <select
            className="template-select"
            aria-label={t('fromTemplate')}
            value=""
            onChange={async (e) => {
              const id = e.target.value;
              if (!id) return;
              const created = await api.useTemplate(id, view.kind === 'notebook' ? view.id : undefined);
              await Promise.all([refreshList(), refreshMeta()]);
              select(created.id);
            }}
          >
            <option value="">{t('fromTemplate')}</option>
            {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.title}</option>)}
          </select>
        )}
        <nav>
          {navItem({ kind: 'all' }, t('allNotes'))}
          {navItem({ kind: 'pinned' }, `📌 ${t('pinned')}`)}
          {navItem({ kind: 'tasks' }, `✅ ${t('tasks')}`)}
          {navItem({ kind: 'reminders' }, `⏰ ${t('reminders')}`)}

          <div className="section-title">
            {t('notebooks')}
            <button
              title={t('newNotebook')}
              aria-label={t('newNotebook')}
              onClick={async () => {
                const name = window.prompt(t('notebookName'));
                if (name?.trim()) { await api.createNotebook(name); void refreshMeta(); }
              }}
            >＋</button>
          </div>
          {stacks.map(([stack, items]) => (
            <div key={stack}>
              {stack && <div className="stack-name">▾ {stack}</div>}
              {items.map((nb) => navItem({ kind: 'notebook', id: nb.id }, nb.name, nb.noteCount, nbActions(nb)))}
            </div>
          ))}

          {tags.length > 0 && <div className="section-title">{t('tags')}</div>}
          <TagTree
            tags={tags}
            render={(tg, label, indent, toggle) =>
              navItem({ kind: 'tag', name: tg.name }, label, tg.total, undefined, indent, toggle)
            }
          />

          {searches.length > 0 && <div className="section-title">{t('savedSearches')}</div>}
          {searches.map((s) => (
            <div className="nav-item" key={s.id}>
              <button className="nav-label" onClick={() => { setQuery(s.query); setView({ kind: 'all' }); }}>🔍 {s.name}</button>
              <span className="row-actions">
                <button aria-label={`${t('delete')} ${s.name}`} onClick={async () => { await api.deleteSearch(s.id); void refreshMeta(); }}>✕</button>
              </span>
            </div>
          ))}

          <div className="section-title" />
          {navItem({ kind: 'trash' }, `🗑 ${t('trash')}`)}
        </nav>
        <div className="sidebar-foot">
          <button onClick={() => importInput.current?.click()}>{t('importEnex')}</button>
          <button onClick={() => importFilesInput.current?.click()}>{t('importFiles')}</button>
          <a href="/api/export/enex" download>{t('exportEnex')}</a>
          <a href="/api/export/zip" download>{t('exportZip')}</a>
          <button onClick={() => setShowSync(true)}>🔄 {t('sync')}</button>
          <input
            ref={importFilesInput}
            type="file"
            accept=".md,.markdown,.html,.htm,.zip"
            multiple
            hidden
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              let notes = 0;
              try {
                for (const file of files) notes += (await api.importMarkdown(file, 'Imported')).notes;
                setToast(t('imported', { n: notes }));
                await Promise.all([refreshList(), refreshMeta()]);
              } catch (err) {
                setToast((err as Error).message);
              }
            }}
          />
          <input
            ref={importInput}
            type="file"
            accept=".enex,.xml"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const r = await api.importEnex(file, file.name.replace(/\.[^.]+$/, ''));
                setToast(t('imported', { n: r.notes }));
                await Promise.all([refreshList(), refreshMeta()]);
              } catch (err) {
                setToast((err as Error).message);
              }
            }}
          />
          <small>🔒 {t('local')}</small>
        </div>
      </aside>

      <section className="list-pane">
        <div className="list-head">
          <h2>{title}</h2>
          {view.kind === 'trash' && notes.length > 0 && (
            <button
              onClick={async () => {
                if (!window.confirm(t('confirmEmptyTrash'))) return;
                await api.emptyTrash();
                await afterRemoval();
              }}
            >{t('emptyTrash')}</button>
          )}
        </div>
        <div className="search">
          <input
            type="search"
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() && !searches.some((s) => s.query === query.trim()) && (
            <button
              title={t('saveSearch')}
              onClick={async () => {
                const name = window.prompt(t('searchName'), query.trim());
                if (name?.trim()) { await api.saveSearch(name, query); void refreshMeta(); }
              }}
            >☆</button>
          )}
        </div>
        {view.kind === 'tasks' ? (
          <TaskPanel
            tasks={tasks}
            status={taskStatus}
            onStatus={setTaskStatus}
            onOpen={(id) => select(id)}
            onToggle={async (tk) => {
              await api.updateTask(tk.noteId, tk.idx, { checked: !tk.checked });
              if (tk.noteId === selectedId) {
                setNote(await api.note(tk.noteId));
                setRev((r) => r + 1);
              }
              await refreshList();
            }}
          />
        ) : (
        <>
        {checked.size > 0 && (
          <div className="selection-bar" role="status">
            <span>{t('selectedN', { n: checked.size })}</span>
            <button
              className="primary"
              disabled={checked.size < 2}
              onClick={async () => {
                if (!window.confirm(t('confirmMerge', { n: checked.size }))) return;
                const ids = notes.filter((n) => checked.has(n.id)).map((n) => n.id);
                const merged = await api.merge(ids);
                setChecked(new Set());
                await Promise.all([refreshList(), refreshMeta()]);
                setRev((r) => r + 1);
                select(merged.id);
              }}
            >{t('merge')}</button>
            <button onClick={() => setChecked(new Set())}>{t('clearSelection')}</button>
          </div>
        )}
        <ul className="notes">
          {notes.length === 0 && <li className="empty">{t('noNotes')}</li>}
          {notes.map((n) => (
            <li key={n.id}>
              <button
                className={`note-item ${n.id === selectedId ? 'active' : ''} ${checked.has(n.id) ? 'checked' : ''}`}
                aria-pressed={checked.has(n.id)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || checked.size > 0) {
                    setChecked((cur) => {
                      const next = new Set(cur);
                      next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                      return next;
                    });
                  } else select(n.id);
                }}
              >
                <div className="note-title">
                  {n.pinned && '📌 '}
                  {n.title || t('untitled')}
                </div>
                <div className="note-snippet">{n.snippet}</div>
                <div className="note-meta">
                  <span>{fmtDate(n.updatedAt)}</span>
                  {n.attachmentCount > 0 && <span>📎 {n.attachmentCount}</span>}
                  {n.reminderAt && <span>⏰</span>}
                  {n.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}
                </div>
              </button>
            </li>
          ))}
        </ul>
        </>
        )}
      </section>

      <main className="editor-pane">
        {!note ? (
          <div className="placeholder">{t('selectNote')}</div>
        ) : (
          <>
            <NoteMeta
              note={note}
              notebooks={notebooks}
              onPatch={patchNote}
              onTrash={async () => { await api.trashNote(note.id); await afterRemoval(); }}
              onRestore={async () => { await api.restoreNote(note.id); await afterRemoval(); }}
              onDelete={async () => {
                if (!window.confirm(t('confirmDelete'))) return;
                await api.deleteNote(note.id);
                await afterRemoval();
              }}
              onHistory={async () => setHistory(await api.versions(note.id))}
              onDuplicate={async () => {
                const copy = await api.duplicate(note.id);
                await Promise.all([refreshList(), refreshMeta()]);
                select(copy.id);
              }}
              onSaveTemplate={async () => {
                await api.saveTemplate(note.id);
                setToast(t('templateSaved'));
                void refreshMeta();
              }}
              backlinks={backlinks}
              onOpenNote={(id) => { window.location.hash = `/note/${id}`; }}
            />
            <NoteEditor key={`${note.id}:${rev}`} note={note} onSaved={onSaved} />
          </>
        )}
      </main>

      {history && note && (
        <div className="modal-backdrop" onClick={() => setHistory(null)}>
          <div className="modal" role="dialog" aria-label={t('history')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('history')}</h3>
            {history.length === 0 && <p>{t('noHistory')}</p>}
            <ul>
              {history.map((v) => (
                <li key={v.id}>
                  <span>{new Date(v.savedAt).toLocaleString(locale)} — {v.title || t('untitled')}</span>
                  <button
                    onClick={async () => {
                      const restored = await api.restoreVersion(note.id, v.id);
                      setNote(restored);
                      setRev((r) => r + 1);
                      setHistory(null);
                      void refreshList();
                    }}
                  >{t('restoreVersion')}</button>
                </li>
              ))}
            </ul>
            <button onClick={() => setHistory(null)}>✕</button>
          </div>
        </div>
      )}

      {showSync && (
        <SyncPanel
          onClose={() => setShowSync(false)}
          onSynced={() => void Promise.all([refreshList(), refreshMeta()])}
        />
      )}

      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>{toast}</div>
      )}
    </div>
  );
}

interface MetaProps {
  note: Note;
  notebooks: Notebook[];
  onPatch: (p: Partial<Note>) => Promise<void>;
  onTrash: () => Promise<void>;
  onRestore: () => Promise<void>;
  onDelete: () => Promise<void>;
  onHistory: () => Promise<void>;
  onDuplicate: () => Promise<void>;
  onSaveTemplate: () => Promise<void>;
  backlinks: { id: string; title: string }[];
  onOpenNote: (id: string) => void;
}

function NoteMeta({ note, notebooks, onPatch, onTrash, onRestore, onDelete, onHistory, onDuplicate, onSaveTemplate, backlinks, onOpenNote }: MetaProps) {
  const [tagInput, setTagInput] = useState('');
  const trashed = note.trashedAt !== null;

  const addTag = () => {
    const name = tagInput.trim().replace(/,$/, '');
    setTagInput('');
    if (name && !note.tags.some((x) => x.toLowerCase() === name.toLowerCase())) void onPatch({ tags: [...note.tags, name] });
  };

  return (
    <div className="note-meta-bar">
      <select
        value={note.notebookId}
        disabled={trashed}
        aria-label={t('notebooks')}
        onChange={(e) => void onPatch({ notebookId: e.target.value })}
      >
        {notebooks.map((nb) => <option key={nb.id} value={nb.id}>{nb.name}</option>)}
      </select>

      {note.sourceUrl && /^https?:\/\//i.test(note.sourceUrl) && (
        <a className="source-link" href={note.sourceUrl} target="_blank" rel="noopener noreferrer" title={note.sourceUrl}>
          🔗 {new URL(note.sourceUrl).hostname}
        </a>
      )}

      <div className="tags">
        {note.tags.map((tag) => (
          <span className="chip" key={tag}>
            {tag}
            {!trashed && (
              <button aria-label={`${t('delete')} ${tag}`} onClick={() => void onPatch({ tags: note.tags.filter((x) => x !== tag) })}>×</button>
            )}
          </span>
        ))}
        {!trashed && (
          <input
            value={tagInput}
            placeholder={t('addTag')}
            aria-label={t('addTag')}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
            }}
            onBlur={addTag}
          />
        )}
      </div>

      <div className="meta-actions">
        {!trashed && (
          <>
            <label className="reminder" title={t('reminder')}>
              ⏰
              <input
                type="datetime-local"
                value={toLocalInput(note.reminderAt)}
                aria-label={t('reminder')}
                onChange={async (e) => {
                  if (e.target.value && 'Notification' in window && Notification.permission === 'default') {
                    void Notification.requestPermission();
                  }
                  await onPatch({ reminderAt: e.target.value ? new Date(e.target.value).getTime() : null });
                }}
              />
              {note.reminderAt && <button onClick={() => void onPatch({ reminderAt: null })}>{t('clearReminder')}</button>}
            </label>
            <button onClick={() => void onPatch({ pinned: !note.pinned })}>{note.pinned ? t('unpin') : t('pin')}</button>
            <button onClick={() => void onHistory()}>{t('history')}</button>
            <button onClick={() => void onDuplicate()}>{t('duplicate')}</button>
            <button onClick={() => void onSaveTemplate()}>{t('saveTemplate')}</button>
            <a href={`/api/notes/${note.id}/export.md`} download>{t('exportMd')}</a>
            <a href={`/api/export/enex?note=${note.id}`} download>ENEX</a>
            <button onClick={() => void onTrash()}>{t('delete')}</button>
          </>
        )}
        {trashed && (
          <>
            <button className="primary" onClick={() => void onRestore()}>{t('restore')}</button>
            <button className="danger" onClick={() => void onDelete()}>{t('deleteForever')}</button>
          </>
        )}
      </div>
      {backlinks.length > 0 && (
        <div className="backlinks">
          {t('linkedFrom')}:
          {backlinks.map((b) => (
            <button key={b.id} className="chip" onClick={() => onOpenNote(b.id)}>{b.title || t('untitled')}</button>
          ))}
        </div>
      )}
    </div>
  );
}

interface TagNode { tag: TagCount; label: string; depth: number; hasChildren: boolean }

/** Flattens "a/b/c" style tags into a collapsible tree. */
function TagTree({ tags, render }: {
  tags: TagCount[];
  render: (tag: TagCount, label: string, indent: number, toggle: React.ReactNode) => React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const nodes: TagNode[] = tags
    .filter((tg) => !tg.virtual || tg.total > 0)
    .map((tg, i, all) => ({
      tag: tg,
      label: tg.name.split('/').pop()!,
      depth: tg.name.split('/').length - 1,
      hasChildren: all.some((o) => o.name.startsWith(`${tg.name}/`)),
    }));
  const hidden = (name: string) =>
    [...collapsed].some((c) => name.startsWith(`${c}/`));
  return (
    <>
      {nodes
        .filter((n) => !hidden(n.tag.name))
        .map((n) =>
          render(
            n.tag,
            n.label,
            n.depth,
            n.hasChildren ? (
              <button
                className="twisty"
                aria-label={collapsed.has(n.tag.name) ? 'expand' : 'collapse'}
                aria-expanded={!collapsed.has(n.tag.name)}
                onClick={() =>
                  setCollapsed((cur) => {
                    const next = new Set(cur);
                    next.has(n.tag.name) ? next.delete(n.tag.name) : next.add(n.tag.name);
                    return next;
                  })
                }
              >
                {collapsed.has(n.tag.name) ? '▸' : '▾'}
              </button>
            ) : (
              <span className="twisty" />
            ),
          ),
        )}
    </>
  );
}

const dayString = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function TaskPanel({ tasks, status, onStatus, onOpen, onToggle }: {
  tasks: Task[];
  status: 'open' | 'done';
  onStatus: (s: 'open' | 'done') => void;
  onOpen: (noteId: string) => void;
  onToggle: (task: Task) => void;
}) {
  const today = dayString();
  const week = dayString(7);
  const groups: [string, Task[]][] =
    status === 'done'
      ? [['', tasks]]
      : [
          [t('overdue'), tasks.filter((x) => x.due && x.due < today)],
          [t('today'), tasks.filter((x) => x.due === today)],
          [t('next7'), tasks.filter((x) => x.due && x.due > today && x.due <= week)],
          [t('later'), tasks.filter((x) => x.due && x.due > week)],
          [t('noDate'), tasks.filter((x) => !x.due)],
        ];
  return (
    <div className="tasks">
      <div className="task-tabs" role="tablist">
        {(['open', 'done'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={status === s} className={status === s ? 'active' : ''} onClick={() => onStatus(s)}>
            {s === 'open' ? t('openTasks') : t('doneTasks')}
          </button>
        ))}
      </div>
      {tasks.length === 0 && <div className="empty">{t('noTasks')}</div>}
      {groups.filter(([, items]) => items.length).map(([label, items]) => (
        <section key={label}>
          {label && <h3 className={label === t('overdue') ? 'overdue' : ''}>{label} <span className="count">{items.length}</span></h3>}
          <ul>
            {items.map((tk) => (
              <li key={`${tk.noteId}:${tk.idx}`} className="task-row">
                <input type="checkbox" checked={tk.checked} aria-label={tk.text} onChange={() => onToggle(tk)} />
                <button className="task-text" onClick={() => onOpen(tk.noteId)}>
                  <span className={tk.checked ? 'done' : ''}>{tk.text || '…'}</span>
                  <small>{tk.noteTitle || t('untitled')}{tk.due ? ` · ${tk.due}` : ''}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
