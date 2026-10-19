import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export type Accent = 'green' | 'blue' | 'violet' | 'orange' | 'pink';
export type Density = 'comfortable' | 'compact';
export type SortKey = 'updated' | 'created' | 'title';
export type Widget = 'tasks' | 'reminders' | 'notebooks' | 'pinned' | 'recent' | 'tags';
export const WIDGETS: Widget[] = ['tasks', 'reminders', 'notebooks', 'pinned', 'recent', 'tags'];
export const HOME_DEFAULT: Widget[] = ['tasks', 'reminders', 'notebooks', 'pinned', 'recent'];

export interface Prefs {
  theme: Theme;
  accent: Accent;
  /** Note list rows: with a text preview, or title and date only. */
  density: Density;
  sort: SortKey;
  /** Hides the sidebar. */
  sidebarHidden: boolean;
  /** Hides the sidebar and the note list, leaving only the editor. */
  focus: boolean;
  /** Sidebar sections folded by hand: 'shortcuts', 'notebooks', 'tags' or `stack:<name>`. */
  collapsed: string[];
  /** Home page widgets, in order; the ones left out are hidden. */
  home: Widget[];
}

export const ACCENTS: Accent[] = ['green', 'blue', 'violet', 'orange', 'pink'];

const defaults: Prefs = { theme: 'system', accent: 'green', density: 'comfortable', sort: 'updated', sidebarHidden: false, focus: false, collapsed: [], home: HOME_DEFAULT };
const KEY = 'opennote.prefs';

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Prefs, unknown>>;
    return {
      theme: oneOf(raw.theme, ['system', 'light', 'dark'], defaults.theme),
      accent: oneOf(raw.accent, ACCENTS, defaults.accent),
      density: oneOf(raw.density, ['comfortable', 'compact'], defaults.density),
      sort: oneOf(raw.sort, ['updated', 'created', 'title'], defaults.sort),
      sidebarHidden: raw.sidebarHidden === true,
      focus: raw.focus === true,
      home: Array.isArray(raw.home) ? [...new Set(raw.home.filter((x): x is Widget => WIDGETS.includes(x as Widget)))] : HOME_DEFAULT,
      collapsed: Array.isArray(raw.collapsed) ? raw.collapsed.filter((x): x is string => typeof x === 'string').slice(0, 200) : [],
      // Older versions also saved `split` (list above editor in narrow windows); it is dropped on the next save.
    };
  } catch {
    return { ...defaults };
  }
}

function apply(p: Prefs) {
  const root = document.documentElement;
  root.dataset.theme = p.theme;
  root.dataset.accent = p.accent;
}

/** Appearance and layout preferences, remembered per browser/profile and applied as attributes on <html>. */
export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(load);
  useEffect(() => {
    apply(prefs);
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* private mode: preferences just last for this session */
    }
  }, [prefs]);
  return [prefs, (patch) => setPrefs((cur) => ({ ...cur, ...patch }))];
}

/** Applies the saved theme before React renders, so the page does not flash the wrong colours. */
export const applySavedPrefs = () => apply(load());
