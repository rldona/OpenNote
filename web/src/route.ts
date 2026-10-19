/**
 * Where you are in OpenNote, written in the address bar (`#/notebook/<id>/note/<id>`), so reloading the page, the back button and
 * a copied link all land in the same place. Pure functions: App.tsx keeps the state and calls these to translate.
 */
export type View =
  | { kind: 'home' }
  | { kind: 'notebooks' }
  | { kind: 'all' }
  | { kind: 'pinned' }
  | { kind: 'reminders' }
  | { kind: 'tasks' }
  | { kind: 'trash' }
  | { kind: 'notebook'; id: string }
  | { kind: 'tag'; name: string };

export interface Route {
  /** null: the address names only a note (old internal links, `#/note/<id>`): keep the current section. */
  view: View | null;
  note: string | null;
}

const SIMPLE: Record<string, View> = {
  notes: { kind: 'all' },
  pinned: { kind: 'pinned' },
  reminders: { kind: 'reminders' },
  tasks: { kind: 'tasks' },
  trash: { kind: 'trash' },
  notebooks: { kind: 'notebooks' },
};
const ID = /^[\w-]{1,64}$/;
const enc = encodeURIComponent;

export function toHash(view: View, note: string | null): string {
  const base =
    view.kind === 'home' ? ''
    : view.kind === 'all' ? 'notes'
    : view.kind === 'notebook' ? `notebook/${enc(view.id)}`
    : view.kind === 'tag' ? `tag/${enc(view.name)}`
    : view.kind;
  const parts = [base, note ? `note/${enc(note)}` : ''].filter(Boolean);
  return `#/${parts.join('/')}`;
}

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let view: View | null = { kind: 'home' };
  let i = 0;
  const head = parts[0];
  if (head && SIMPLE[head]) {
    view = SIMPLE[head]!;
    i = 1;
  } else if ((head === 'notebook' || head === 'tag') && parts[1]) {
    const arg = decode(parts[1]);
    if (arg && (head === 'tag' ? arg.length <= 200 : ID.test(arg))) view = head === 'tag' ? { kind: 'tag', name: arg } : { kind: 'notebook', id: arg };
    i = 2;
  } else if (head === 'note') {
    view = null; // only a note
  }
  let note: string | null = null;
  const at = parts.indexOf('note', i);
  if (at >= 0 && parts[at + 1]) {
    const id = decode(parts[at + 1]!);
    if (id && ID.test(id)) note = id;
  }
  // An unreadable address falls back to the home page rather than a blank view.
  if (head && !SIMPLE[head] && head !== 'note' && head !== 'notebook' && head !== 'tag') view = { kind: 'home' };
  if (view === null && note === null) view = { kind: 'home' };
  return { view, note };
}
