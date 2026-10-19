import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Task, type Note, type NoteSummary, type Notebook, type SavedSearch, type TagCount, type Version } from './api';
import { AttachmentsPanel } from './Attachments';
import { Home } from './Home';
import { NoteEditor } from './Editor';
import { SyncPanel } from './SyncPanel';
import { LockedNote } from './Locked';
import { Icon, type IconName } from './Icon';
import { PromptHost, askText } from './Prompt';
import { NotebooksOverview } from './Notebooks';
import { ACCENTS, usePrefs, type Accent, type SortKey, type Theme } from './prefs';
import { isEncryptedHtml, type NoteCipher } from './crypto';
import { locale, t } from './i18n';

type View =
  | { kind: 'home' }
  | { kind: 'notebooks' }
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
  const [view, setView] = useState<View>({ kind: 'home' });
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
  const [serverDown, setServerDown] = useState(false);
  /** An encrypted note that was unlocked in this window: its plaintext and key live only here. */
  const [unlocked, setUnlocked] = useState<{ id: string; html: string; cipher: NoteCipher } | null>(null);
  useEffect(() => setUnlocked(null), [selectedId]);
  const [history, setHistory] = useState<Version[] | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const searchInput = useRef<HTMLInputElement>(null);
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

  // Notes can also arrive from outside this window (quick note, web clipper, sync): refresh on focus.
  useEffect(() => {
    const onFocus = () => {
      void refreshList();
      void refreshMeta();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshList, refreshMeta]);
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

  // Google Drive (browser build): renewals need a click, and a sync is useful whenever the page comes back or goes online.
  useEffect(() => {
    if (!__STANDALONE__) return;
    let last = 0;
    const syncIfOn = async () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      try {
        const cfg = await api.syncConfig();
        if (cfg.enabled && cfg.remote) {
          await api.syncNow();
          void refreshList();
          void refreshMeta();
        }
      } catch {
        /* the sync panel shows the details */
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void syncIfOn();
    const needsClick = () => setToast(t('driveNeedsClick'));
    const renewed = () => {
      setToast(t('driveRenewed'));
      last = 0;
      void syncIfOn();
    };
    const reconnect = () => setToast(t('driveReconnect'));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('opennote:drive-needs-click', needsClick);
    window.addEventListener('opennote:drive-renewed', renewed);
    window.addEventListener('opennote:drive-needs-connect', reconnect);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('opennote:drive-needs-click', needsClick);
      window.removeEventListener('opennote:drive-renewed', renewed);
      window.removeEventListener('opennote:drive-needs-connect', reconnect);
    };
  }, [refreshList, refreshMeta]);

  // The local server may stop (or not be started yet): show a banner instead of a silently empty app.
  useEffect(() => {
    const down = () => setServerDown(true);
    const up = () => {
      setServerDown(false);
      void refreshList();
      void refreshMeta();
    };
    window.addEventListener('opennote:offline', down);
    window.addEventListener('opennote:online', up);
    return () => {
      window.removeEventListener('opennote:offline', down);
      window.removeEventListener('opennote:online', up);
    };
  }, [refreshList, refreshMeta]);

  // Internal links look like #/note/<id>.
  useEffect(() => {
    const go = () => {
      const m = /^#\/note\/([\w-]+)$/.exec(window.location.hash);
      if (m) {
        setSelectedId(m[1]!);
        setView((v) => (v.kind === 'home' || v.kind === 'notebooks' ? { kind: 'all' } : v));
      }
      else if (window.location.hash === '#/tasks') setView({ kind: 'tasks' });
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
    if (id) setView((v) => (v.kind === 'home' || v.kind === 'notebooks' ? { kind: 'all' } : v));
  };

  const createNote = async () => {
    const created = await api.createNote({ notebookId: view.kind === 'notebook' ? view.id : undefined, tags: view.kind === 'tag' ? [view.name] : undefined });
    if (view.kind === 'trash') setView({ kind: 'all' });
    await Promise.all([refreshList(), refreshMeta()]);
    select(created.id);
  };
  const createNoteRef = useRef(createNote);
  createNoteRef.current = createNote;

  // Shortcuts: "/" jumps to search, Ctrl/Cmd+N starts a note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setPrefs({ sidebarHidden: false, focus: false });
        setTimeout(() => searchInput.current?.focus(), 0);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void createNoteRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      case 'home': return t('home');
      case 'notebooks': return t('notebooks');
      case 'all': return t('allNotes');
      case 'pinned': return t('pinned');
      case 'reminders': return t('reminders');
      case 'tasks': return t('tasks');
      case 'trash': return t('trash');
      case 'notebook': return notebooks.find((n) => n.id === view.id)?.name ?? '';
      case 'tag': return `# ${view.name}`;
    }
  }, [view, notebooks]);

  /** Pinned first, then the chosen order. "Last updated" is how the server already returns the list. */
  const shownNotes = useMemo(() => {
    const cmp: Record<SortKey, ((a: NoteSummary, b: NoteSummary) => number) | null> = {
      updated: null,
      created: (a, b) => b.createdAt - a.createdAt,
      title: (a, b) => (a.title || t('untitled')).localeCompare(b.title || t('untitled'), locale, { sensitivity: 'base' }),
    };
    const by = cmp[prefs.sort];
    return by ? [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || by(a, b)) : notes;
  }, [notes, prefs.sort]);

  const updatedByNotebook = useMemo(() => {
    const out: Record<string, number> = {};
    if (view.kind === 'notebooks') for (const n of notes) out[n.notebookId] = Math.max(out[n.notebookId] ?? 0, n.updatedAt);
    return out;
  }, [notes, view.kind]);

  const askNewNotebook = async () => {
    const name = await askText(t('notebookName'));
    if (name?.trim()) { await api.createNotebook(name); void refreshMeta(); }
  };

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
    toggle?: ReactNode,
    icon?: IconName,
  ) => (
    <div className={`nav-item ${same(view, v) ? 'active' : ''}`} key={JSON.stringify(v)} style={{ paddingLeft: indent * 14 }}>
      {toggle}
      <button className="nav-label" onClick={() => { setView(v); select(null); }} aria-current={same(view, v) ? 'page' : undefined}>
        <span className="nav-text">{icon && <Icon name={icon} size={16} />}<span>{label}</span></span>
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
          const name = await askText(t('notebookName'), nb.name);
          if (name?.trim()) { await api.updateNotebook(nb.id, { name }); void refreshMeta(); }
        }}
      ><Icon name="pencil" size={13} /></button>
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
      ><Icon name="close" size={13} /></button>
    </span>
  );

  const overview = !note && (view.kind === 'home' || view.kind === 'notebooks');
  const sortLabels: Record<SortKey, string> = { updated: t('sortUpdated'), created: t('sortCreated'), title: t('sortTitle') };
  const startSearch = (value: string) => {
    setQuery(value);
    if (value.trim() && (view.kind === 'home' || view.kind === 'notebooks')) setView({ kind: 'all' });
  };
  const importFilesChanged = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    let count = 0;
    try {
      for (const file of files) count += (await api.importMarkdown(file, 'Imported')).notes;
      setToast(t('imported', { n: count }));
      await Promise.all([refreshList(), refreshMeta()]);
    } catch (err) {
      setToast((err as Error).message);
    }
  };
  const importEnexChanged = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
  };

  const layout = [
    'app',
    prefs.focus ? 'focus' : '',
    prefs.sidebarHidden || prefs.focus ? 'no-sidebar' : '',
    overview || prefs.focus ? 'no-list' : '',
    prefs.density === 'compact' ? 'dense' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={layout}>
      {serverDown && (
        <div className="offline-banner" role="alert">
          {t('serverDown')}
          <button onClick={() => { void refreshList(); void refreshMeta(); }}>{t('retry')}</button>
        </div>
      )}
      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="brand" onClick={() => { setView({ kind: 'home' }); select(null); }} aria-label={`OpenNote — ${t('home')}`}>
            <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="26" height="26" />
            <span>OpenNote</span>
          </button>
          <button className="icon-btn" title={t('hideSidebar')} aria-label={t('hideSidebar')} onClick={() => setPrefs({ sidebarHidden: true })}>
            <Icon name="sidebar" />
          </button>
        </div>
        <div className="new-row">
          <button className="primary new-note with-icon" onClick={() => void createNote()}><Icon name="plus" size={16} />{t('newNote')}</button>
          {templates.length > 0 && (
            <select
              className="template-select"
              aria-label={t('fromTemplate')}
              title={t('fromTemplate')}
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
        </div>
        <div className="search">
          <Icon name="search" size={16} />
          <input
            ref={searchInput}
            type="search"
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(e) => startSearch(e.target.value)}
          />
          {query.trim() && !searches.some((s) => s.query === query.trim()) && (
            <button
              className="icon-btn"
              title={t('saveSearch')}
              aria-label={t('saveSearch')}
              onClick={async () => {
                const name = await askText(t('searchName'), query.trim());
                if (name?.trim()) { await api.saveSearch(name, query); void refreshMeta(); }
              }}
            ><Icon name="star" size={16} /></button>
          )}
        </div>
        <nav>
          {navItem({ kind: 'home' }, t('home'), undefined, undefined, 0, undefined, 'home')}
          {navItem({ kind: 'all' }, t('allNotes'), undefined, undefined, 0, undefined, 'notes')}
          {navItem({ kind: 'pinned' }, t('pinned'), undefined, undefined, 0, undefined, 'pin')}
          {navItem({ kind: 'tasks' }, t('tasks'), undefined, undefined, 0, undefined, 'tasks')}
          {navItem({ kind: 'reminders' }, t('reminders'), undefined, undefined, 0, undefined, 'bell')}

          <div className="section-title">
            <button className="section-link" onClick={() => { setView({ kind: 'notebooks' }); select(null); }}>{t('notebooks')}</button>
            <button className="icon-btn" title={t('newNotebook')} aria-label={t('newNotebook')} onClick={() => void askNewNotebook()}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          {stacks.map(([stack, items]) => (
            <div key={stack}>
              {stack && <div className="stack-name"><Icon name="folder" size={13} />{stack}</div>}
              {items.map((nb) => navItem({ kind: 'notebook', id: nb.id }, nb.name, nb.noteCount, nbActions(nb), 0, undefined, 'notebook'))}
            </div>
          ))}

          {tags.length > 0 && <div className="section-title"><span>{t('tags')}</span></div>}
          <TagTree
            tags={tags}
            render={(tg, label, indent, toggle) =>
              navItem({ kind: 'tag', name: tg.name }, label, tg.total, undefined, indent, toggle, 'tag')
            }
          />

          {searches.length > 0 && <div className="section-title"><span>{t('savedSearches')}</span></div>}
          {searches.map((s) => (
            <div className="nav-item" key={s.id}>
              <button className="nav-label" onClick={() => { startSearch(s.query); setView({ kind: 'all' }); }}>
                <span className="nav-text"><Icon name="search" size={16} /><span>{s.name}</span></span>
              </button>
              <span className="row-actions">
                <button aria-label={`${t('delete')} ${s.name}`} onClick={async () => { await api.deleteSearch(s.id); void refreshMeta(); }}><Icon name="close" size={13} /></button>
              </span>
            </div>
          ))}

          <div className="section-title" />
          {navItem({ kind: 'trash' }, t('trash'), undefined, undefined, 0, undefined, 'trash')}
        </nav>
        <div className="sidebar-foot">
          <div className="foot-actions">
            <button className="icon-btn" title={t('sync')} aria-label={t('sync')} onClick={() => setShowSync(true)}><Icon name="sync" /></button>
            <Popover icon="download" label={t('data')}>
              <button onClick={() => importInput.current?.click()}><Icon name="upload" size={16} />{t('importEnex')}</button>
              <button onClick={() => importFilesInput.current?.click()}><Icon name="upload" size={16} />{t('importFiles')}</button>
              <a href="/api/export/enex" download><Icon name="download" size={16} />{t('exportEnex')}</a>
              <a href="/api/export/zip" download><Icon name="download" size={16} />{t('exportZip')}</a>
            </Popover>
            <Popover icon="palette" label={t('appearance')} keepOpen>
              <Appearance prefs={prefs} onChange={setPrefs} />
            </Popover>
          </div>
          <input ref={importFilesInput} type="file" accept=".md,.markdown,.html,.htm,.zip" multiple hidden onChange={importFilesChanged} />
          <input ref={importInput} type="file" accept=".enex,.xml" hidden onChange={importEnexChanged} />
          <small><Icon name="lock" size={12} /> {t('local')}</small>
        </div>
      </aside>

      <section className="list-pane">
        <div className="list-head">
          <h2>{title}</h2>
          <div className="list-tools">
            {view.kind === 'trash' && notes.length > 0 && (
              <button
                className="text-btn"
                onClick={async () => {
                  if (!window.confirm(t('confirmEmptyTrash'))) return;
                  await api.emptyTrash();
                  await afterRemoval();
                }}
              >{t('emptyTrash')}</button>
            )}
            {view.kind !== 'tasks' && (
              <>
                <button
                  className="icon-btn"
                  title={prefs.density === 'compact' ? t('densityComfortable') : t('densityCompact')}
                  aria-label={t('density')}
                  aria-pressed={prefs.density === 'compact'}
                  onClick={() => setPrefs({ density: prefs.density === 'compact' ? 'comfortable' : 'compact' })}
                ><Icon name={prefs.density === 'compact' ? 'compact' : 'list'} /></button>
                <Popover icon="sort" label={`${t('sortBy')}: ${sortLabels[prefs.sort]}`} align="right">
                  {(Object.keys(sortLabels) as SortKey[]).map((k) => (
                    <button key={k} className={prefs.sort === k ? 'selected' : ''} onClick={() => setPrefs({ sort: k })}>
                      <span className="check">{prefs.sort === k && <Icon name="check" size={14} />}</span>{sortLabels[k]}
                    </button>
                  ))}
                </Popover>
              </>
            )}
          </div>
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
          {shownNotes.length === 0 && <li className="empty">{t('noNotes')}</li>}
          {shownNotes.map((n) => (
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
                  {n.pinned && <Icon name="pin" size={13} />}
                  <span>{n.title || t('untitled')}</span>
                </div>
                <div className="note-snippet">{n.snippet}</div>
                <div className="note-meta">
                  <span>{fmtDate(prefs.sort === 'created' ? n.createdAt : n.updatedAt)}</span>
                  {n.attachmentCount > 0 && <span className="meta-icon"><Icon name="clip" size={12} />{n.attachmentCount}</span>}
                  {n.reminderAt && <span className="meta-icon"><Icon name="bell" size={12} /></span>}
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
        {prefs.focus && (
          <button className="focus-exit" onClick={() => setPrefs({ focus: false })}>{t('exitFocus')}</button>
        )}
        {prefs.sidebarHidden && !prefs.focus && (
          <button className="icon-btn sidebar-show" title={t('showSidebar')} aria-label={t('showSidebar')} onClick={() => setPrefs({ sidebarHidden: false })}>
            <Icon name="sidebar" />
          </button>
        )}
        {!note ? (
          view.kind === 'notebooks' ? (
            <NotebooksOverview
              notebooks={notebooks}
              updated={updatedByNotebook}
              onOpen={(id) => { setView({ kind: 'notebook', id }); select(null); }}
              onCreate={() => void askNewNotebook()}
            />
          ) : view.kind === 'home' ? (
            <Home
              refreshToken={notes}
              onOpen={(id) => select(id)}
              onOpenTasks={() => setView({ kind: 'tasks' })}
              onOpenNotebooks={() => setView({ kind: 'notebooks' })}
              onOpenNotebook={(id) => setView({ kind: 'notebook', id })}
              onOpenPinned={() => setView({ kind: 'pinned' })}
              onCreate={async (title) => {
                const created = await api.createNote({ title, notebookId: undefined });
                await Promise.all([refreshList(), refreshMeta()]);
                select(created.id);
              }}
            />
          ) : (
            <div className="placeholder">{t('selectNote')}</div>
          )
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
              focus={prefs.focus}
              onFocus={() => setPrefs({ focus: !prefs.focus })}
              onSaveTemplate={async () => {
                await api.saveTemplate(note.id);
                setToast(t('templateSaved'));
                void refreshMeta();
              }}
              backlinks={backlinks}
              onOpenNote={(id) => { window.location.hash = `/note/${id}`; }}
            />
            {isEncryptedHtml(note.content) && unlocked?.id !== note.id ? (
              <LockedNote content={note.content} onUnlock={(html, cipher) => setUnlocked({ id: note.id, html, cipher })} />
            ) : unlocked?.id === note.id ? (
              <NoteEditor key={`${note.id}:${rev}:unlocked`} note={{ ...note, content: unlocked.html }} onSaved={onSaved} initialCipher={unlocked.cipher} />
            ) : (
              <NoteEditor key={`${note.id}:${rev}`} note={note} onSaved={onSaved} />
            )}
            <AttachmentsPanel noteId={note.id} refreshKey={note.updatedAt} readOnly={note.trashedAt !== null} />
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
          onSynced={(r, auto) => {
            void Promise.all([refreshList(), refreshMeta()]);
            setToast(`${t('syncDone', { pushed: r.pushed, pulled: r.pulled })}${auto ? ` · ${t('autoSyncOn')}` : ''}`);
          }}
        />
      )}

      <PromptHost />

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
  focus: boolean;
  onFocus: () => void;
  onSaveTemplate: () => Promise<void>;
  backlinks: { id: string; title: string }[];
  onOpenNote: (id: string) => void;
}

function NoteMeta({ note, notebooks, onPatch, onTrash, onRestore, onDelete, onHistory, onDuplicate, focus, onFocus, onSaveTemplate, backlinks, onOpenNote }: MetaProps) {
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
          <Icon name="link" size={12} /> {new URL(note.sourceUrl).hostname}
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
            <Popover icon="bell" label={t('reminder')} align="right" keepOpen active={!!note.reminderAt}>
              <label className="reminder">
                <span>{t('reminder')}</span>
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
              </label>
              {note.reminderAt && <button onClick={() => void onPatch({ reminderAt: null })}>{t('clearReminder')}</button>}
            </Popover>
            <button
              className={`icon-btn ${note.pinned ? 'on' : ''}`}
              title={note.pinned ? t('unpin') : t('pin')}
              aria-label={note.pinned ? t('unpin') : t('pin')}
              aria-pressed={note.pinned}
              onClick={() => void onPatch({ pinned: !note.pinned })}
            ><Icon name="pin" /></button>
            <button className="icon-btn" title={t('history')} aria-label={t('history')} onClick={() => void onHistory()}><Icon name="history" /></button>
            <button className="icon-btn" title={focus ? t('exitFocus') : t('focusMode')} aria-label={t('focusMode')} aria-pressed={focus} onClick={onFocus}><Icon name="focus" /></button>
            <Popover icon="more" label={t('more')} align="right">
              <button onClick={() => void onDuplicate()}><Icon name="copy" size={16} />{t('duplicate')}</button>
              <button onClick={() => void onSaveTemplate()}><Icon name="template" size={16} />{t('saveTemplate')}</button>
              <a href={`/api/notes/${note.id}/export.md`} download><Icon name="download" size={16} />{t('exportMd')}</a>
              <a href={`/api/export/enex?note=${note.id}`} download><Icon name="download" size={16} />ENEX</a>
              <button className="danger" onClick={() => void onTrash()}><Icon name="trash" size={16} />{t('delete')}</button>
            </Popover>
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

/** An icon button that opens a small floating panel; closes on outside click, Escape and (unless keepOpen) on choosing an item. */
function Popover({ icon, label, children, align = 'left', keepOpen = false, active = false }: {
  icon: IconName;
  label: string;
  children: ReactNode;
  align?: 'left' | 'right';
  keepOpen?: boolean;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="popover" ref={box}>
      <button
        className={`icon-btn ${active ? 'on' : ''}`}
        title={label}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      ><Icon name={icon} /></button>
      {open && (
        <div
          className={`popover-panel ${align}`}
          onClick={(e) => {
            if (!keepOpen && (e.target as HTMLElement).closest('button, a')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Appearance({ prefs, onChange }: {
  prefs: { theme: Theme; accent: Accent };
  onChange: (patch: { theme?: Theme; accent?: Accent }) => void;
}) {
  const themes: [Theme, IconName, string][] = [
    ['system', 'monitor', t('themeSystem')],
    ['light', 'sun', t('themeLight')],
    ['dark', 'moon', t('themeDark')],
  ];
  const accents: Record<Accent, string> = {
    green: t('accentGreen'), blue: t('accentBlue'), violet: t('accentViolet'), orange: t('accentOrange'), pink: t('accentPink'),
  };
  return (
    <div className="appearance">
      <div className="panel-label">{t('theme')}</div>
      <div className="segmented" role="group" aria-label={t('theme')}>
        {themes.map(([value, icon, label]) => (
          <button key={value} className={prefs.theme === value ? 'active' : ''} aria-pressed={prefs.theme === value} onClick={() => onChange({ theme: value })}>
            <Icon name={icon} size={15} />{label}
          </button>
        ))}
      </div>
      <div className="panel-label">{t('accent')}</div>
      <div className="swatches" role="group" aria-label={t('accent')}>
        {ACCENTS.map((a) => (
          <button key={a} className={`swatch ${prefs.accent === a ? 'active' : ''}`} data-accent={a} title={accents[a]} aria-label={accents[a]} aria-pressed={prefs.accent === a} onClick={() => onChange({ accent: a })} />
        ))}
      </div>
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
