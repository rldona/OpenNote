import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { api, type NoteSummary, type Notebook, type Task } from './api';
import { locale, t } from './i18n';

const dayString = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Props {
  onOpen: (noteId: string) => void;
  onOpenTasks: () => void;
  onOpenNotebooks: () => void;
  onOpenNotebook: (id: string) => void;
  onOpenPinned: () => void;
  onCreate: (title: string) => Promise<void>;
  /** Changes whenever notes may have changed, so the dashboard reloads. */
  refreshToken: unknown;
}

/** Start page shown while no note is open: what needs attention and what you touched last. */
export function Home({ onOpen, onOpenTasks, onOpenNotebooks, onOpenNotebook, onOpenPinned, onCreate, refreshToken }: Props) {
  const [recent, setRecent] = useState<NoteSummary[]>([]);
  const [pinned, setPinned] = useState<NoteSummary[]>([]);
  const [reminders, setReminders] = useState<NoteSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.notes({}), api.notes({ pinned: true }), api.notes({ reminders: true }), api.tasks('open'), api.notebooks()])
      .then(([all, pin, rem, tk, nbs]) => {
        if (cancelled) return;
        setRecent([...all].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8));
        setPinned(pin.slice(0, 6));
        setReminders([...rem].sort((a, b) => (a.reminderAt ?? 0) - (b.reminderAt ?? 0)).slice(0, 5));
        setTasks(tk);
        setNotebooks(nbs);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

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

  return (
    <div className="home">
      <h1>{greeting}</h1>
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

      <div className="home-grid">
        <section>
          <h2>{t('upcomingTasks')} <button className="link" onClick={onOpenTasks}>{t('viewAll')}</button></h2>
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
        </section>

        <section>
          <h2>{t('upcomingReminders')}</h2>
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
        </section>

        {pinned.length > 0 && (
          <section>
            <h2>{t('pinned')} <button className="link" onClick={onOpenPinned}>{t('viewAll')}</button></h2>
            <ul>{pinned.map(note)}</ul>
          </section>
        )}

        <section>
          <h2>{t('notebooks')} <button className="link" onClick={onOpenNotebooks}>{t('viewAll')}</button></h2>
          <div className="mini-notebooks">
            {notebooks.slice(0, 6).map((nb) => (
              <button key={nb.id} className="mini-notebook" onClick={() => onOpenNotebook(nb.id)}>
                <Icon name="notebook" size={16} />
                <span>{nb.name}</span>
                <small>{nb.noteCount}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="wide">
          <h2>{t('recentNotes')}</h2>
          {recent.length === 0 && <p className="muted">{t('noNotes')}</p>}
          <ul>{recent.map(note)}</ul>
        </section>
      </div>
    </div>
  );
}
