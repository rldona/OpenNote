import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export type Accent = 'green' | 'blue' | 'violet' | 'orange' | 'pink';
export type Density = 'comfortable' | 'compact';
export type SortKey = 'updated' | 'created' | 'title';

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
  /** Narrow windows stack the note list above the editor: percentage of the height the list takes. null = the default. */
  split: number | null;
}

/** List 20% / note 80%. */
export const SPLIT_DEFAULT = 20;
/** The list can shrink to 15% (never out of sight) and the editor keeps at least 20%. */
export const SPLIT_MIN = 15;
export const SPLIT_MAX = 80;
export const clampSplit = (n: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Number.isFinite(n) ? n : SPLIT_DEFAULT));

export const ACCENTS: Accent[] = ['green', 'blue', 'violet', 'orange', 'pink'];

const defaults: Prefs = { theme: 'system', accent: 'green', density: 'comfortable', sort: 'updated', sidebarHidden: false, focus: false, split: null };
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
      // A saved 40 is the old default (every earlier save wrote it), not a choice: it moves to the new default.
      split: typeof raw.split === 'number' && raw.split !== 40 ? clampSplit(raw.split) : null,
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
