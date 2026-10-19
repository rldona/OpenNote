import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { api, type NoteSummary, type Notebook, type SavedSearch, type TagCount } from './api';
import { t } from './i18n';

const RECENT_KEY = 'opennote.recentSearches';

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function remember(q: string) {
  const query = q.trim();
  if (!query) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([query, ...loadRecent().filter((x) => x !== query)].slice(0, 8)));
  } catch {
    /* private mode: recent searches just are not kept */
  }
}

/** Operators the search understands (see parseQuery on the server), offered as one-tap refinements. */
const OPERATORS = ['tag:', 'notebook:', 'intitle:', 'todo:true', 'resource:*', 'reminderTime:*', 'created:week', 'updated:day', '-tag:'];

const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);

interface Props {
  notebooks: Notebook[];
  tags: TagCount[];
  searches: SavedSearch[];
  /** Opens a result. */
  onOpen: (id: string) => void;
  /** Shows every result in the note list. */
  onShowAll: (q: string) => void;
  onClose: () => void;
}

/**
 * Search panel (⌘K / Ctrl+K, or the Search tab on phones): live results while typing, refinements for the search operators
 * with completion of tag and notebook names, and recent and saved searches when empty.
 */
export function SearchPanel({ notebooks, tags, searches, onOpen, onShowAll, onClose }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<NoteSummary[]>([]);
  const [active, setActive] = useState(0);
  const [recent] = useState(loadRecent);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    let cancelled = false;
    const id = setTimeout(() => {
      api.notes({ q }).then((r) => {
        if (cancelled) return;
        setResults(r);
        setActive(0);
      }).catch(() => undefined);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q]);

  // The word being typed: `tag:wo` completes to tag names, `notebook:pro` to notebook names.
  const last = q.split(/\s+/).pop() ?? '';
  const completions = useMemo(() => {
    const m = /^(-?)(tag|notebook):"?(.*)$/i.exec(last);
    if (!m) return [];
    const [, neg, op, part] = m;
    const lower = part!.toLowerCase();
    const names = op!.toLowerCase() === 'tag' ? tags.filter((x) => !x.virtual).map((x) => x.name) : notebooks.map((x) => x.name);
    return names.filter((n) => n.toLowerCase().includes(lower)).slice(0, 8).map((n) => `${neg}${op!.toLowerCase()}:${quote(n)}`);
  }, [last, tags, notebooks]);

  const apply = (token: string, replaceLast: boolean) => {
    const words = q.trim() ? q.trimEnd().split(/\s+/) : [];
    if (replaceLast) words.pop();
    const next = [...words, token].join(' ');
    setQ(token.endsWith(':') ? next : `${next} `);
    input.current?.focus();
  };

  const open = (id: string) => {
    remember(q);
    onOpen(id);
  };
  const showAll = () => {
    remember(q);
    onShowAll(q.trim());
  };

  const shown = results.slice(0, 20);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal search-panel" role="dialog" aria-label={t('searchTab')}>
        <div className="search-top">
          <div className="search">
            <Icon name="search" size={18} />
            <input
              ref={input}
              autoFocus
              type="search"
              value={q}
              placeholder={t('search')}
              aria-label={t('search')}
              role="combobox"
              aria-expanded={shown.length > 0}
              aria-controls="search-results"
              aria-activedescendant={shown[active] ? `result-${shown[active].id}` : undefined}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) open(shown[active].id); else if (q.trim()) showAll(); }
                else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
              }}
            />
          </div>
          <button className="text-btn search-cancel" onClick={onClose}>{t('cancel')}</button>
        </div>

        <div className="search-chips" aria-label={t('refine')}>
          {(completions.length > 0 ? completions : OPERATORS).map((op) => (
            <button key={op} className="filter" onMouseDown={(e) => e.preventDefault()} onClick={() => apply(op, completions.length > 0)}>{op}</button>
          ))}
        </div>

        <div className="search-body">
          {!q.trim() && (
            <>
              {recent.length > 0 && <div className="panel-label">{t('recentSearches')}</div>}
              {recent.map((r) => (
                <button key={r} className="search-row" onClick={() => setQ(r)}><Icon name="history" size={16} /><span>{r}</span></button>
              ))}
              {searches.length > 0 && <div className="panel-label">{t('savedSearches')}</div>}
              {searches.map((s) => (
                <button key={s.id} className="search-row" onClick={() => setQ(s.query)}><Icon name="star" size={16} /><span>{s.name}</span><small>{s.query}</small></button>
              ))}
            </>
          )}
          {q.trim() && shown.length === 0 && <p className="muted search-empty">{t('noResults')}</p>}
          <ul id="search-results" role="listbox" ref={list}>
            {shown.map((n, i) => (
              <li key={n.id} id={`result-${n.id}`} role="option" aria-selected={i === active}>
                <button className="search-result" onMouseEnter={() => setActive(i)} onClick={() => open(n.id)}>
                  <strong>{n.pinned && <Icon name="pin" size={13} />}{n.title || t('untitled')}</strong>
                  <small>{n.snippet}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {q.trim() && results.length > 0 && (
          <div className="search-foot">
            <button className="text-btn" onClick={showAll}>{results.length === 1 ? t('showOneResult') : t('showAllResults', { n: results.length })}</button>
            <span className="muted">{t('searchHint')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
