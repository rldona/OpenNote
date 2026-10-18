import { Icon } from './Icon';
import type { Notebook } from './api';
import { locale, t } from './i18n';

interface Props {
  notebooks: Notebook[];
  /** Most recent update per notebook id, in ms. */
  updated: Record<string, number>;
  onOpen: (id: string) => void;
  onCreate: () => void;
}

/** Overview of every notebook as cards, grouped by stack. */
export function NotebooksOverview({ notebooks, updated, onOpen, onCreate }: Props) {
  const stacks = new Map<string, Notebook[]>();
  for (const nb of notebooks) stacks.set(nb.stack ?? '', [...(stacks.get(nb.stack ?? '') ?? []), nb]);
  const date = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="page notebooks-page">
      <header className="page-head">
        <div>
          <h1>{t('notebooks')}</h1>
          <p className="muted">{t('notebooksIntro')}</p>
        </div>
        <button className="primary with-icon" onClick={onCreate}><Icon name="plus" size={16} />{t('newNotebook')}</button>
      </header>
      {[...stacks.entries()].map(([stack, items]) => (
        <section key={stack}>
          {stack && <h2 className="stack-title"><Icon name="folder" size={14} />{stack}</h2>}
          <div className="card-grid">
            {items.map((nb, i) => (
              <button key={nb.id} className="notebook-card" data-tone={i % 5} onClick={() => onOpen(nb.id)}>
                <span className="notebook-cover"><Icon name="notebook" size={22} /></span>
                <strong>{nb.name}</strong>
                <span className="muted">
                  {nb.noteCount === 1 ? t('noteCountOne') : t('notesCount', { n: nb.noteCount })}
                  {updated[nb.id] ? ` · ${t('updatedOn', { date: date(updated[nb.id]!) })}` : nb.noteCount === 0 ? ` · ${t('emptyNotebook')}` : ''}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
