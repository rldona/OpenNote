import { useEffect, useState } from 'react';

/**
 * Window size classes. App.tsx puts `layout-<size>` on the app root and styles.css lays the panes out from that class,
 * so these queries are the only place the breakpoints live.
 *  - xl: sidebar, note list and editor side by side;
 *  - l: the same, with narrower columns (tablet in landscape, small laptops);
 *  - m: note list and editor; the sidebar opens as a drawer over them (tablet in portrait);
 *  - s: one screen at a time with a bottom bar (phones, and any short landscape window that is not wide).
 */
export type Size = 'xl' | 'l' | 'm' | 's';

const QUERIES: [Size, string][] = [
  ['s', '(max-width: 699.98px), (max-height: 499.98px) and (max-width: 1023.98px)'],
  ['m', '(max-width: 1023.98px)'],
  ['l', '(max-width: 1279.98px)'],
];

function current(): Size {
  for (const [size, query] of QUERIES) if (window.matchMedia(query).matches) return size;
  return 'xl';
}

export function useLayout(): Size {
  const [size, setSize] = useState(current);
  useEffect(() => {
    const lists = QUERIES.map(([, q]) => window.matchMedia(q));
    const on = () => setSize(current());
    for (const m of lists) m.addEventListener('change', on);
    return () => {
      for (const m of lists) m.removeEventListener('change', on);
    };
  }, []);
  return size;
}
