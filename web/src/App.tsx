import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type SyncStatus, type Task, type Note, type NoteSummary, type Notebook, type SavedSearch, type TagCount, type Version } from './api';
import { AttachmentsPanel } from './Attachments';
import { Home } from './Home';
import { NoteEditor } from './Editor';
import { SyncPanel } from './SyncPanel';
import { LockedNote } from './Locked';
import { Icon, type IconName } from './Icon';
import { parseHash, toHash, type View } from './route';
import { PromptHost, askText } from './Prompt';
import { NotebooksOverview } from './Notebooks';
import { SearchPanel } from './Search';
import { SwipeRow } from './Swipe';
import { ACCENTS, usePrefs, type Accent, type SortKey, type Theme } from './prefs';
import { useLayout } from './layout';
import { isEncryptedHtml, type NoteCipher } from './crypto';
import { locale, t } from './i18n';

/** Tags listed in the sidebar before "Show all". */
const TOP_TAGS = 5;

const same = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

const toLocalInput = (ms: number | null) => {
  if (!ms) return '';
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

/** "5 minutes ago", "yesterday"… in the interface language. */
const ago = (ms: number) => {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const min = Math.round((ms - Date.now()) / 60000);
  if (min > -60) return rtf.format(min, 'minute');
  const h = Math.round(min / 60);
  return h > -24 ? rtf.format(h, 'hour') : rtf.format(Math.round(h / 24), 'day');
};

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

export function App() {
  const [view, setView] = useState<View>(() => parseHash(window.location.hash).view ?? { kind: 'all' });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskStatus, setTaskStatus] = useState<'open' | 'done'>('open');
  const [selectedId, setSelectedId] = useState<string | null>(() => parseHash(window.location.hash).note);
  const [note, setNote] = useState<Note | null>(null);
  const [rev, setRev] = useState(0);
  const [templates, setTemplates] = useState<NoteSummary[]>([]);
  const [pinnedNotes, setPinnedNotes] = useState<NoteSummary[]>([]);
  /** Quick filters above the note list, added to the search as operators (see parseQuery on the server). */
  const [filters, setFilters] = useState<string[]>([]);
  const [allTags, setAllTags] = useState(false);
  const [syncInfo, setSyncInfo] = useState<{ on: boolean; status: SyncStatus | null }>({ on: false, status: null });
  const [, setClock] = useState(0);
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
  // Below xl (see layout.ts) the sidebar is a drawer over the content, closed until asked for and closed
  // again when a section is chosen or the window changes size class.
  const size = useLayout();
  const drawer = size !== 'xl';
  const phone = size === 's';
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => setDrawerOpen(false), [size]);
  // Phones: the app follows the part of the screen the keyboard leaves visible, so the toolbar sits right above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!phone || !vv) return;
    const root = document.documentElement;
    const on = () => {
      root.style.setProperty('--vvh', `${vv.height}px`);
      root.style.setProperty('--vvtop', `${vv.offsetTop}px`);
    };
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vvtop');
    };
  }, [phone]);
  /** The search panel (⌘K / Ctrl+K, "/", the Search tab on phones and the search button of the rail). */
  const [searchOpen, setSearchOpen] = useState(false);
  /** A note opened from inside the app on a phone: its back button can step back through the browser history. */
  const openedHere = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const phoneSearchInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const importFilesInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  const refreshMeta = useCallback(async () => {
    const [nb, tg, ss, pn] = await Promise.all([api.notebooks(), api.tags(), api.searches(), api.notes({ pinned: true })]);
    setNotebooks(nb);
    setTags(tg);
    setSearches(ss);
    setPinnedNotes(pn);
    setTemplates(await api.templates());
  }, []);

  const refreshList = useCallback(async () => {
    if (view.kind === 'tasks') {
      setTasks(await api.tasks(taskStatus));
      return;
    }
    setNotes(
      await api.notes({
        q: [debouncedQuery, ...filters].join(' ').trim(),
        notebook: view.kind === 'notebook' ? view.id : undefined,
        tag: view.kind === 'tag' ? view.name : undefined,
        trashed: view.kind === 'trash',
        pinned: view.kind === 'pinned',
        reminders: view.kind === 'reminders',
      }),
    );
  }, [view, debouncedQuery, filters, taskStatus]);

  // Filters belong to the list they were picked on.
  useEffect(() => setFilters([]), [view]);

  // Sync state for the sidebar footer, refreshed now and then and after each sync; the clock keeps "3 min ago" current.
  const refreshSync = useCallback(async () => {
    try {
      const [cfg, status] = await Promise.all([api.syncConfig(), api.syncStatus()]);
      setSyncInfo({ on: cfg.enabled && (!!cfg.folder || cfg.remote), status });
    } catch {
      /* not available in this build or the server is down: the footer keeps saying the notes are stored locally */
    }
  }, []);
  useEffect(() => {
    void refreshSync();
    const id = setInterval(() => { void refreshSync(); setClock((c) => c + 1); }, 60_000);
    return () => clearInterval(id);
  }, [refreshSync]);

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

  // The address bar follows where you are (see route.ts): reloading, the back button and copied links land in the same place.
  useEffect(() => {
    const wanted = toHash(view, selectedId);
    const current = window.location.hash;
    if (current === wanted || (wanted === '#/' && current === '')) return;
    // An older link (#/note/<id>) is rewritten in place; anything else is a step the back button can undo.
    if (parseHash(current).view === null) window.history.replaceState(null, '', wanted);
    else window.history.pushState(null, '', wanted);
  }, [view, selectedId]);

  // ...and the other way round: the back/forward buttons or a link to #/note/<id> change what is shown.
  useEffect(() => {
    const go = () => {
      const r = parseHash(window.location.hash);
      openedHere.current = false;
      setSelectedId(r.note);
      setHistory(null);
      setView((cur) => {
        const next = r.view ?? (cur.kind === 'home' || cur.kind === 'notebooks' ? { kind: 'all' as const } : cur);
        return same(cur, next) ? cur : next;
      });
    };
    window.addEventListener('hashchange', go);
    window.addEventListener('popstate', go);
    return () => {
      window.removeEventListener('hashchange', go);
      window.removeEventListener('popstate', go);
    };
  }, []);

  // A notebook that no longer exists (deleted on another device, old link): show all notes instead of an empty list.
  useEffect(() => {
    if (view.kind === 'notebook' && notebooks.length > 0 && !notebooks.some((n) => n.id === view.id)) setView({ kind: 'all' });
  }, [view, notebooks]);

  useEffect(() => {
    if (!selectedId) return setBacklinks([]);
    let cancelled = false;
    api.backlinks(selectedId).then((b) => !cancelled && setBacklinks(b)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, rev, note?.updatedAt]);

  const select = (id: string | null) => {
    openedHere.current = id !== null;
    setSelectedId(id);
    setHistory(null);
    if (id) setView((v) => (v.kind === 'home' || v.kind === 'notebooks' ? { kind: 'all' } : v));
  };

  const createNote = async () => {
    setDrawerOpen(false);
    const created = await api.createNote({ notebookId: view.kind === 'notebook' ? view.id : undefined, tags: view.kind === 'tag' ? [view.name] : undefined });
    if (view.kind === 'trash') setView({ kind: 'all' });
    await Promise.all([refreshList(), refreshMeta()]);
    select(created.id);
  };
  const fromTemplate = async (id: string) => {
    setDrawerOpen(false);
    const created = await api.useTemplate(id, view.kind === 'notebook' ? view.id : undefined);
    await Promise.all([refreshList(), refreshMeta()]);
    select(created.id);
  };
  const createNoteRef = useRef(createNote);
  createNoteRef.current = createNote;

  const openSearch = () => {
    setDrawerOpen(false);
    setSearchOpen(true);
  };
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;

  // Shortcuts: "/" and Ctrl/Cmd+K open the search panel, Ctrl/Cmd+N starts a note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if ((e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey)) {
        e.preventDefault();
        openSearchRef.current();
      } else if (e.key === 'Escape') {
        setDrawerOpen(false);
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
    // Stacks first, so their notebooks never read as part of the loose notebook above them.
    return [...map.entries()].sort(([a], [b]) => Number(!a) - Number(!b) || a.localeCompare(b, locale, { sensitivity: 'base' }));
  }, [notebooks]);

  const folded = (key: string) => prefs.collapsed.includes(key);
  const toggleFold = (key: string) =>
    setPrefs({ collapsed: folded(key) ? prefs.collapsed.filter((k) => k !== key) : [...prefs.collapsed, key] });
  /** A sidebar section heading that folds its section; `open` (notebooks) also makes the name a link to the overview. */
  const sectionToggle = (key: string, label: string, open?: () => void) => (
    <span className="section-toggle">
      <button className="fold" aria-expanded={!folded(key)} aria-label={`${label}: ${folded(key) ? '▸' : '▾'}`} onClick={() => toggleFold(key)}>
        {folded(key) ? '▸' : '▾'}
      </button>
      {open ? <button className="section-link" onClick={open}>{label}</button> : <button className="section-link" onClick={() => toggleFold(key)}>{label}</button>}
    </span>
  );
  const visibleTags = tags.filter((tg) => !tg.virtual || tg.total > 0);
  const visibleTagCount = visibleTags.length;
  const topTags = useMemo(() => [...visibleTags].filter((tg) => !tg.virtual).sort((a, b) => b.total - a.total).slice(0, TOP_TAGS), [tags]);

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
      <button className="nav-label" onClick={() => { setView(v); select(null); setDrawerOpen(false); }} aria-current={same(view, v) ? 'page' : undefined}>
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

  // Which panes show. xl/l: sidebar (unless hidden), list (unless an overview or focus) and editor. m: list and editor, the
  // sidebar as a drawer. s: one pane at a time, the editor whenever a note or an overview page is open.
  const noList = overview || prefs.focus;
  const sidebarHidden = !drawer && (prefs.focus || prefs.sidebarHidden);
  // l: a rail of icons stands in for the sidebar, whose full version opens from it as a drawer.
  const rail = size === 'l' && !prefs.focus;
  const showSidebar = () => (drawer ? setDrawerOpen(true) : setPrefs({ sidebarHidden: false }));
  const hideSidebar = () => (drawer ? setDrawerOpen(false) : setPrefs({ sidebarHidden: true }));
  /** The button that brings the sidebar back: in the list header when there is one, floating over the page otherwise. */
  const menuButton = !prefs.focus && (size === 'm' || (size === 'xl' && prefs.sidebarHidden));
  const menuFloating = menuButton && noList;
  const phonePane = note || overview ? 'editor' : 'list';
  const goBack = () => {
    if (openedHere.current) window.history.back();
    else select(null);
  };
  const railItem = (v: View, label: string, icon: IconName) => (
    <button
      key={label}
      className={`icon-btn ${same(view, v) && !note ? 'on' : ''}`}
      title={label}
      aria-label={label}
      aria-current={same(view, v) ? 'page' : undefined}
      onClick={() => { setView(v); select(null); }}
    ><Icon name={icon} /></button>
  );
  const noteTags = note && (
    <NoteTags note={note} onPatch={patchNote} backlinks={backlinks} onOpenNote={(id) => { window.location.hash = `/note/${id}`; }} />
  );
  const searchField = (ref: React.Ref<HTMLInputElement>, onEnter?: () => void) => (
    <div className="search">
      <Icon name="search" size={16} />
      <input
        ref={ref}
        type="search"
        value={query}
        placeholder={t('search')}
        aria-label={t('search')}
        onChange={(e) => startSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
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
  );

  const layout = [
    'app',
    `layout-${size}`,
    prefs.focus ? 'focus' : '',
    sidebarHidden ? 'no-sidebar' : '',
    noList ? 'no-list' : '',
    drawer && drawerOpen ? 'drawer-open' : '',
    menuFloating ? 'menu-floating' : '',
    phone ? `pane-${phonePane}` : '',
    phone && note ? 'note-open' : '',
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
      {drawer && drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />}
      <aside className="sidebar" aria-hidden={drawer && !drawerOpen ? true : undefined}>
        <div className="sidebar-top">
          <button className="brand" onClick={() => { setView({ kind: 'home' }); select(null); setDrawerOpen(false); }} aria-label={`OpenNote — ${t('home')}`}>
            <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="26" height="26" />
            <span>OpenNote</span>
          </button>
          <button className="icon-btn" title={drawer ? t('close') : t('hideSidebar')} aria-label={drawer ? t('close') : t('hideSidebar')} onClick={hideSidebar}>
            <Icon name={drawer ? 'close' : 'sidebar'} />
          </button>
        </div>
        <div className="new-row">
          <button className="primary new-note with-icon" onClick={() => void createNote()}><Icon name="plus" size={16} />{t('newNote')}</button>
          <Popover icon="caret" label={t('newNoteMenu')} className="new-more">
            <button onClick={() => void createNote()}><Icon name="notes" size={16} />{t('blankNote')}</button>
            <div className="panel-label">{t('fromTemplate').replace(/…$/, '')}</div>
            {templates.length === 0 && <p className="panel-note">{t('noTemplates')}</p>}
            {templates.map((tp) => (
              <button key={tp.id} onClick={() => void fromTemplate(tp.id)}><Icon name="template" size={16} />{tp.title || t('untitled')}</button>
            ))}
          </Popover>
        </div>
        {searchField(searchInput, () => setDrawerOpen(false))}
        <nav>
          {navItem({ kind: 'home' }, t('home'), undefined, undefined, 0, undefined, 'home')}
          {navItem({ kind: 'all' }, t('allNotes'), undefined, undefined, 0, undefined, 'notes')}
          {navItem({ kind: 'pinned' }, t('pinned'), undefined, undefined, 0, undefined, 'pin')}
          {navItem({ kind: 'tasks' }, t('tasks'), undefined, undefined, 0, undefined, 'tasks')}
          {navItem({ kind: 'reminders' }, t('reminders'), undefined, undefined, 0, undefined, 'bell')}

          {(pinnedNotes.length > 0 || searches.length > 0) && (
            <>
              <div className="section-title">{sectionToggle('shortcuts', t('shortcutsSection'))}</div>
              {!folded('shortcuts') && (
                <>
                  {pinnedNotes.slice(0, 12).map((n) => (
                    <div className={`nav-item ${n.id === selectedId ? 'active' : ''}`} key={n.id}>
                      <button className="nav-label" onClick={() => { select(n.id); setDrawerOpen(false); }}>
                        <span className="nav-text"><Icon name="pin" size={16} /><span>{n.title || t('untitled')}</span></span>
                      </button>
                    </div>
                  ))}
                  {searches.map((sv) => (
                    <div className="nav-item" key={sv.id}>
                      <button className="nav-label" onClick={() => { startSearch(sv.query); setView({ kind: 'all' }); select(null); setDrawerOpen(false); }}>
                        <span className="nav-text"><Icon name="search" size={16} /><span>{sv.name}</span></span>
                      </button>
                      <span className="row-actions">
                        <button aria-label={`${t('delete')} ${sv.name}`} onClick={async () => { await api.deleteSearch(sv.id); void refreshMeta(); }}><Icon name="close" size={13} /></button>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          <div className="section-title">
            {sectionToggle('notebooks', t('notebooks'), () => { setView({ kind: 'notebooks' }); select(null); setDrawerOpen(false); })}
            <button className="icon-btn" title={t('newNotebook')} aria-label={t('newNotebook')} onClick={() => void askNewNotebook()}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          {!folded('notebooks') && stacks.map(([stack, items]) => (
            <div key={stack}>
              {stack && (
                <button className="stack-name" aria-expanded={!folded(`stack:${stack}`)} onClick={() => toggleFold(`stack:${stack}`)}>
                  <span className="fold" aria-hidden="true">{folded(`stack:${stack}`) ? '▸' : '▾'}</span>
                  <Icon name="folder" size={14} /><span>{stack}</span>
                  <span className="count">{items.reduce((n, nb) => n + nb.noteCount, 0)}</span>
                </button>
              )}
              {!(stack && folded(`stack:${stack}`)) &&
                items.map((nb) => navItem({ kind: 'notebook', id: nb.id }, nb.name, nb.noteCount, nbActions(nb), stack ? 1 : 0, undefined, 'notebook'))}
            </div>
          ))}

          {tags.length > 0 && <div className="section-title">{sectionToggle('tags', t('tags'))}</div>}
          {tags.length > 0 && !folded('tags') && (
            allTags ? (
              <TagTree
                tags={tags}
                render={(tg, label, indent, toggle) =>
                  navItem({ kind: 'tag', name: tg.name }, label, tg.total, undefined, indent, toggle, 'tag')
                }
              />
            ) : (
              topTags.map((tg) => navItem({ kind: 'tag', name: tg.name }, tg.name, tg.total, undefined, 0, <span className="twisty" />, 'tag'))
            )
          )}
          {tags.length > 0 && !folded('tags') && visibleTagCount > TOP_TAGS && (
            <button className="more-link" onClick={() => setAllTags((v) => !v)}>
              {allTags ? t('showFewerTags') : t('showAllTags', { n: visibleTagCount })}
            </button>
          )}

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
          {syncInfo.on && syncInfo.status?.running ? (
            <small><Icon name="sync" size={12} /> {t('syncingNow')}</small>
          ) : syncInfo.on && syncInfo.status && !syncInfo.status.ok && syncInfo.status.lastRunAt ? (
            <button className="sync-line error" onClick={() => setShowSync(true)}><Icon name="sync" size={12} /> {t('syncProblem')}</button>
          ) : syncInfo.on && syncInfo.status?.lastRunAt ? (
            <button className="sync-line" onClick={() => setShowSync(true)} title={new Date(syncInfo.status.lastRunAt).toLocaleString(locale)}>
              <Icon name="sync" size={12} /> {t('syncedWhen', { when: ago(syncInfo.status.lastRunAt) })}
            </button>
          ) : (
            <small><Icon name="lock" size={12} /> {t('local')}</small>
          )}
        </div>
      </aside>

      {rail && (
        <nav className="rail" aria-label={t('menu')}>
          <button className="icon-btn" title={t('showSidebar')} aria-label={t('showSidebar')} aria-expanded={drawerOpen} onClick={showSidebar}><Icon name="menu" /></button>
          <button className="icon-btn rail-new" title={t('newNote')} aria-label={t('newNote')} onClick={() => void createNote()}><Icon name="plus" /></button>
          <button className="icon-btn" title={t('searchTab')} aria-label={t('searchTab')} onClick={openSearch}><Icon name="search" /></button>
          <span className="rail-sep" />
          {railItem({ kind: 'home' }, t('home'), 'home')}
          {railItem({ kind: 'all' }, t('allNotes'), 'notes')}
          {railItem({ kind: 'pinned' }, t('pinned'), 'pin')}
          {railItem({ kind: 'tasks' }, t('tasks'), 'tasks')}
          {railItem({ kind: 'reminders' }, t('reminders'), 'bell')}
          {railItem({ kind: 'notebooks' }, t('notebooks'), 'notebook')}
          <span className="rail-gap" />
          {railItem({ kind: 'trash' }, t('trash'), 'trash')}
          <button className="icon-btn" title={t('sync')} aria-label={t('sync')} onClick={() => setShowSync(true)}><Icon name="sync" /></button>
        </nav>
      )}
      <section className="list-pane">
        <div className="list-head">
          {menuButton && !menuFloating && (
            <button className="icon-btn" title={t('showSidebar')} aria-label={t('showSidebar')} onClick={showSidebar}>
              <Icon name={drawer ? 'menu' : 'sidebar'} />
            </button>
          )}
          <div className="list-title">
            <h2>{title}</h2>
            {view.kind !== 'tasks' && <small>{shownNotes.length === 1 ? t('noteCountOne') : t('notesCount', { n: shownNotes.length })}</small>}
          </div>
          <div className="list-tools">
            {view.kind !== 'trash' && view.kind !== 'tasks' && (
              <button className="icon-btn list-new" title={t('newNoteHere')} aria-label={t('newNoteHere')} onClick={() => void createNote()}><Icon name="plus" /></button>
            )}
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
        {phone && query && view.kind !== 'tasks' && (
          <div className="phone-search">
            {searchField(phoneSearchInput, () => phoneSearchInput.current?.blur())}
            <button className="text-btn" onClick={() => setQuery('')}>{t('cancel')}</button>
          </div>
        )}
        {view.kind !== 'tasks' && (
          <div className="filters" role="group" aria-label={t('filters')}>
            {([
              ['todo:true', t('filterOpenTasks'), 'tasks'],
              ['resource:*', t('filterFiles'), 'clip'],
              ['reminderTime:*', t('filterReminder'), 'bell'],
              ['updated:week', t('filterWeek'), 'calendar'],
            ] as const).map(([op, label, icon]) => (
              <button
                key={op}
                className={`filter ${filters.includes(op) ? 'on' : ''}`}
                aria-pressed={filters.includes(op)}
                onClick={() => setFilters((cur) => (cur.includes(op) ? cur.filter((x) => x !== op) : [...cur, op]))}
              ><Icon name={icon} size={13} />{label}</button>
            ))}
          </div>
        )}
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
              <SwipeRow
                enabled={phone && view.kind !== 'trash' && checked.size === 0}
                right={{
                  label: n.pinned ? t('unpin') : t('pin'),
                  icon: 'pin',
                  run: async () => {
                    await api.updateNote(n.id, { pinned: !n.pinned });
                    setToast(n.pinned ? t('unpinned') : t('pinned1'));
                    await Promise.all([refreshList(), refreshMeta()]);
                  },
                }}
                left={{
                  label: t('delete'),
                  icon: 'trash',
                  run: async () => {
                    await api.trashNote(n.id);
                    if (n.id === selectedId) select(null);
                    setToast(t('movedToTrash'));
                    await Promise.all([refreshList(), refreshMeta()]);
                  },
                }}
              >
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
              </SwipeRow>
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
        {menuFloating && (
          <button className="icon-btn sidebar-show" title={t('showSidebar')} aria-label={t('showSidebar')} onClick={showSidebar}>
            <Icon name={drawer ? 'menu' : 'sidebar'} />
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
              onOpenTag={(name) => setView({ kind: 'tag', name })}
              widgets={prefs.home}
              onWidgets={(home) => setPrefs({ home })}
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
              onBack={phone ? goBack : undefined}
            />
            {isEncryptedHtml(note.content) && unlocked?.id !== note.id ? (
              <>
                {noteTags}
                <LockedNote content={note.content} onUnlock={(html, cipher) => setUnlocked({ id: note.id, html, cipher })} />
              </>
            ) : unlocked?.id === note.id ? (
              <NoteEditor key={`${note.id}:${rev}:unlocked`} note={{ ...note, content: unlocked.html }} onSaved={onSaved} initialCipher={unlocked.cipher} aside={noteTags} />
            ) : (
              <NoteEditor key={`${note.id}:${rev}`} note={note} onSaved={onSaved} aside={noteTags} />
            )}
            <AttachmentsPanel noteId={note.id} refreshKey={note.updatedAt} readOnly={note.trashedAt !== null} />
          </>
        )}
      </main>

      {phone && (
        <nav className="bottom-nav" aria-label={t('menu')}>
          <button aria-current={view.kind === 'home' && !note ? 'page' : undefined} onClick={() => { setView({ kind: 'home' }); select(null); }}>
            <Icon name="home" size={22} /><span>{t('home')}</span>
          </button>
          <button
            aria-current={phonePane === 'list' && !searchOpen ? 'page' : undefined}
            onClick={() => { setView((v) => (v.kind === 'home' || v.kind === 'notebooks' ? { kind: 'all' } : v)); select(null); }}
          >
            <Icon name="notes" size={22} /><span>{t('notesTab')}</span>
          </button>
          <button className="bottom-new" aria-label={t('newNote')} title={t('newNote')} onClick={() => void createNote()}>
            <Icon name="plus" size={24} />
          </button>
          <button aria-current={searchOpen ? 'page' : undefined} onClick={openSearch}>
            <Icon name="search" size={22} /><span>{t('searchTab')}</span>
          </button>
          <button aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
            <Icon name="menu" size={22} /><span>{t('more')}</span>
          </button>
        </nav>
      )}

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
          onClose={() => { setShowSync(false); void refreshSync(); }}
          onSynced={(r, auto) => {
            void Promise.all([refreshList(), refreshMeta(), refreshSync()]);
            setToast(`${t('syncDone', { pushed: r.pushed, pulled: r.pulled })}${auto ? ` · ${t('autoSyncOn')}` : ''}`);
          }}
        />
      )}

      {searchOpen && (
        <SearchPanel
          notebooks={notebooks}
          tags={tags}
          searches={searches}
          onClose={() => setSearchOpen(false)}
          onOpen={(id) => { setSearchOpen(false); select(id); }}
          onShowAll={(q) => { setSearchOpen(false); setQuery(q); setView({ kind: 'all' }); select(null); }}
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
  /** Phones: the note fills the screen, and this goes back to where it was opened from. */
  onBack?: () => void;
}

function NoteMeta({ note, notebooks, onPatch, onTrash, onRestore, onDelete, onHistory, onDuplicate, focus, onFocus, onSaveTemplate, onBack }: MetaProps) {
  const trashed = note.trashedAt !== null;
  const stack = notebooks.find((nb) => nb.id === note.notebookId)?.stack;

  return (
    <div className="note-meta-bar">
      {onBack && (
        <button className="icon-btn back-btn" title={t('back')} aria-label={t('back')} onClick={onBack}><Icon name="back" /></button>
      )}
      {stack && <span className="crumb" title={stack}><Icon name="folder" size={13} /><span>{stack}</span><span aria-hidden="true">›</span></span>}
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
            <button className="icon-btn history-btn" title={t('history')} aria-label={t('history')} onClick={() => void onHistory()}><Icon name="history" /></button>
            <button className="icon-btn focus-btn" title={focus ? t('exitFocus') : t('focusMode')} aria-label={t('focusMode')} aria-pressed={focus} onClick={onFocus}><Icon name="focus" /></button>
            <Popover icon="more" label={t('more')} align="right">
              <button className="menu-history" onClick={() => void onHistory()}><Icon name="history" size={16} />{t('history')}</button>
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
    </div>
  );
}

/** Tags (and the notes that link here) under the title, where they scroll with the note. */
function NoteTags({ note, onPatch, backlinks, onOpenNote }: {
  note: Note;
  onPatch: (p: Partial<Note>) => Promise<void>;
  backlinks: { id: string; title: string }[];
  onOpenNote: (id: string) => void;
}) {
  const [tagInput, setTagInput] = useState('');
  const trashed = note.trashedAt !== null;
  const addTag = () => {
    const name = tagInput.trim().replace(/,$/, '');
    setTagInput('');
    if (name && !note.tags.some((x) => x.toLowerCase() === name.toLowerCase())) void onPatch({ tags: [...note.tags, name] });
  };
  return (
    <div className="note-tags">
      <div className="tags">
        <Icon name="tag" size={14} />
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
function Popover({ icon, label, children, align = 'left', keepOpen = false, active = false, className = '' }: {
  icon: IconName;
  className?: string;
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
        className={`icon-btn ${className} ${active ? 'on' : ''}`}
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
