import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { api, type NoteSummary, type Notebook, type TagCount, type Task } from './api';
import { WIDGETS, type Widget } from './prefs';
import { locale, t } from './i18n';

const dayString = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** How wide each widget likes to be: small, medium or the whole row. */
const PREFERRED: Record<Widget, 's' | 'm' | 'l'> = { tasks: 'm', reminders: 's', notebooks: 'm', pinned: 's', recent: 'l', tags: 's' };

/**
 * Column spans (out of 12) for the widgets in order. Rows are filled greedily and the last widget of a row grows to the end of
 * it, so the grid never leaves a hole whatever is shown, hidden or reordered.
 */
export function widgetSpans(ids: Widget[], columns: 1 | 2 | 3): number[] {
  const unit = columns === 3 ? { s: 4, m: 8, l: 12 } : columns === 2 ? { s: 6, m: 6, l: 12 } : { s: 12, m: 12, l: 12 };
  const out: number[] = [];
  let used = 0;
  for (const id of ids) {
    const w = unit[PREFERRED[id]];
    if (used + w > 12) {
      out[out.length - 1]! += 12 - used;
      used = 0;
    }
    out.push(w);
    used += w;
  }
  if (out.length && used < 12) out[out.length - 1]! += 12 - used;
  return out;
}

interface Props {
  onOpen: (noteId: string) => void;
  onOpenTasks: () => void;
  onOpenNotebooks: () => void;
  onOpenNotebook: (id: string) => void;
  onOpenPinned: () => void;
  onOpenTag: (name: string) => void;
  onCreate: (title: string) => Promise<void>;
  /** Changes whenever notes may have changed, so the dashboard reloads. */
  refreshToken: unknown;
  widgets: Widget[];
  onWidgets: (widgets: Widget[]) => void;
}

/** Start page shown while no note is open: what needs attention and what you touched last, as widgets you can arrange. */
export function Home({ onOpen, onOpenTasks, onOpenNotebooks, onOpenNotebook, onOpenPinned, onOpenTag, onCreate, refreshToken, widgets, onWidgets }: Props) {
  const [recent, setRecent] = useState<NoteSummary[]>([]);
  const [pinned, setPinned] = useState<NoteSummary[]>([]);
  const [reminders, setReminders] = useState<NoteSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<1 | 2 | 3>(3);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.notes({}), api.notes({ pinned: true }), api.notes({ reminders: true }), api.tasks('open'), api.notebooks(), api.tags()])
      .then(([all, pin, rem, tk, nbs, tg]) => {
        if (cancelled) return;
        setRecent([...all].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8));
        setPinned(pin.slice(0, 6));
        setReminders([...rem].sort((a, b) => (a.reminderAt ?? 0) - (b.reminderAt ?? 0)).slice(0, 5));
        setTasks(tk);
        setNotebooks(nbs);
        setTags(tg.filter((x) => !x.virtual).sort((a, b) => b.total - a.total).slice(0, 14));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  // The grid's own width (not the window's) picks the column count: the sidebar and list take different room per layout.
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => setColumns(el.clientWidth >= 860 ? 3 : el.clientWidth >= 540 ? 2 : 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 6 ? t('goodNight') : hour < 13 ? t('goodMorning') : hour < 21 ? t('goodAfternoon') : t('goodNight');
  const soon = dayString(7);
  const dueTasks = tasks.filter((x) => x.due && x.due <= soon).slice(0, 6);
  const today = dayString();

  const note = (n: NoteSummary) => (
    <li key={n.id}>
      <button className="home-note" onClick={() => onOpen(n.id)}>
        <strong>{n.pinned && <Icon name="pin" size={13} />}{n.title || t('untitled')}</strong>
        <small>{n.snippet}</small>
      </button>
    </li>
  );

  const titles: Record<Widget, string> = {
    tasks: t('upcomingTasks'),
    reminders: t('upcomingReminders'),
    notebooks: t('notebooks'),
    pinned: t('pinned'),
    recent: t('recentNotes'),
    tags: t('widgetTags'),
  };
  const links: Partial<Record<Widget, () => void>> = { tasks: onOpenTasks, notebooks: onOpenNotebooks, pinned: onOpenPinned };

  const bodies: Record<Widget, () => ReactNode> = {
    tasks: () => (
      <>
        {dueTasks.length === 0 && <p className="muted">{t('nothingDue')}</p>}
        <ul>
          {dueTasks.map((tk) => (
            <li key={`${tk.noteId}:${tk.idx}`} className="task-row">
              <input
                type="checkbox"
                aria-label={tk.text}
                onChange={async () => {
                  await api.updateTask(tk.noteId, tk.idx, { checked: true });
                  setTasks((cur) => cur.filter((x) => !(x.noteId === tk.noteId && x.idx === tk.idx)));
                }}
              />
              <button className="task-text" onClick={() => onOpen(tk.noteId)}>
                <span>{tk.text || '…'}</span>
                <small className={tk.due! < today ? 'overdue' : ''}>{tk.due === today ? t('today') : tk.due}{' · '}{tk.noteTitle || t('untitled')}</small>
              </button>
            </li>
          ))}
        </ul>
      </>
    ),
    reminders: () => (
      <>
        {reminders.length === 0 && <p className="muted">{t('nothingScheduled')}</p>}
        <ul>
          {reminders.map((n) => (
            <li key={n.id}>
              <button className="home-note" onClick={() => onOpen(n.id)}>
                <strong><Icon name="bell" size={13} />{n.title || t('untitled')}</strong>
                <small>{n.reminderAt ? new Date(n.reminderAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</small>
              </button>
            </li>
          ))}
        </ul>
      </>
    ),
    notebooks: () => (
      <div className="mini-notebooks">
        {notebooks.slice(0, 6).map((nb) => (
          <button key={nb.id} className="mini-notebook" onClick={() => onOpenNotebook(nb.id)}>
            <Icon name="notebook" size={16} />
            <span>{nb.name}</span>
            <small>{nb.noteCount}</small>
          </button>
        ))}
      </div>
    ),
    pinned: () => (pinned.length === 0 ? <p className="muted">{t('noNotes')}</p> : <ul>{pinned.map(note)}</ul>),
    recent: () => (recent.length === 0 ? <p className="muted">{t('noNotes')}</p> : <ul className="recent">{recent.map(note)}</ul>),
    tags: () => (
      tags.length === 0 ? <p className="muted">{t('noNotes')}</p> : (
        <div className="home-tags">
          {tags.map((tg) => (
            <button key={tg.name} className="chip" onClick={() => onOpenTag(tg.name)}>{tg.name}<small>{tg.total}</small></button>
          ))}
        </div>
      )
    ),
  };

  // Pinned has nothing to show without pinned notes; while arranging, every chosen widget stays visible.
  const shown = widgets.filter((w) => editing || w !== 'pinned' || pinned.length > 0);
  const spans = widgetSpans(shown, columns);
  const hidden = WIDGETS.filter((w) => !widgets.includes(w));
  const move = (w: Widget, by: number) => {
    const i = widgets.indexOf(w);
    const j = i + by;
    if (j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onWidgets(next);
  };

  return (
    <div className="home">
      <div className="home-head">
        <h1>{greeting}</h1>
        <button className={`text-btn ${editing ? 'on' : ''}`} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
          {editing ? t('done') : t('customize')}
        </button>
      </div>
      <p className="tip muted">{t('shortcuts')}</p>
      <form
        className="capture"
        onSubmit={async (e) => {
          e.preventDefault();
          const title = draft.trim();
          if (!title) return;
          setDraft('');
          await onCreate(title);
        }}
      >
        <input value={draft} placeholder={t('captureHint')} aria-label={t('captureHint')} onChange={(e) => setDraft(e.target.value)} />
        <button className="primary" type="submit" disabled={!draft.trim()} aria-label={t('newNote')}><Icon name="plus" /></button>
      </form>

      <div className={`home-grid ${editing ? 'editing' : ''}`} ref={grid}>
        {shown.map((w, i) => (
          <section key={w} className={`w-${w}`} style={{ gridColumn: `span ${spans[i]}` }}>
            <h2>
              <span>{titles[w]}</span>
              {editing ? (
                <span className="widget-tools">
                  <button className="icon-btn" title={t('moveUp')} aria-label={`${t('moveUp')}: ${titles[w]}`} disabled={i === 0} onClick={() => move(w, -1)}><Icon name="back" size={15} /></button>
                  <button className="icon-btn" title={t('moveDown')} aria-label={`${t('moveDown')}: ${titles[w]}`} disabled={i === shown.length - 1} onClick={() => move(w, 1)}><Icon name="chevron" size={15} /></button>
                  <button className="icon-btn" title={t('hideWidget')} aria-label={`${t('hideWidget')}: ${titles[w]}`} onClick={() => onWidgets(widgets.filter((x) => x !== w))}><Icon name="close" size={15} /></button>
                </span>
              ) : (
                links[w] && <button className="link" onClick={links[w]}>{t('viewAll')}</button>
              )}
            </h2>
            {bodies[w]()}
          </section>
        ))}
      </div>
      {editing && hidden.length > 0 && (
        <div className="hidden-widgets">
          <span className="muted">{t('hiddenWidgets')}:</span>
          {hidden.map((w) => (
            <button key={w} className="filter" onClick={() => onWidgets([...widgets, w])}><Icon name="plus" size={13} />{titles[w]}</button>
          ))}
        </div>
      )}
    </div>
  );
}
