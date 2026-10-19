import { describe, expect, it } from 'vitest';
import { parseHash, toHash, type View } from '../../web/src/route.js';

const ID = '0e4ed5de-e822-467f-9de3-06a0eda1297a';
const NOTE = '0e1d9b5c-1c43-4a05-8d1e-111111111111';

describe('address of the current view', () => {
  const views: View[] = [
    { kind: 'home' }, { kind: 'all' }, { kind: 'pinned' }, { kind: 'reminders' }, { kind: 'tasks' }, { kind: 'trash' }, { kind: 'notebooks' },
    { kind: 'notebook', id: ID }, { kind: 'tag', name: 'work/projects/alpha' }, { kind: 'tag', name: 'café & té' },
  ];

  it('round-trips every view, with and without an open note', () => {
    for (const view of views) {
      // Opening a note always leaves Home and the notebooks overview (App.tsx moves to "All notes"), so that pair never exists.
      const notes = view.kind === 'home' || view.kind === 'notebooks' ? [null] : [null, NOTE];
      for (const note of notes) {
        expect(parseHash(toHash(view, note))).toEqual({ view, note });
      }
    }
  });

  it('uses readable addresses', () => {
    expect(toHash({ kind: 'home' }, null)).toBe('#/');
    expect(toHash({ kind: 'all' }, NOTE)).toBe(`#/notes/note/${NOTE}`);
    expect(toHash({ kind: 'notebook', id: ID }, NOTE)).toBe(`#/notebook/${ID}/note/${NOTE}`);
    expect(toHash({ kind: 'tag', name: 'a/b' }, null)).toBe('#/tag/a%2Fb'); // the slash inside a tag does not split the address
    expect(toHash({ kind: 'tasks' }, null)).toBe('#/tasks');
  });

  it('understands the older internal links and the empty address', () => {
    expect(parseHash(`#/note/${NOTE}`)).toEqual({ view: null, note: NOTE }); // keep the current section
    expect(parseHash('#/tasks')).toEqual({ view: { kind: 'tasks' }, note: null });
    expect(parseHash('')).toEqual({ view: { kind: 'home' }, note: null });
    expect(parseHash('#')).toEqual({ view: { kind: 'home' }, note: null });
  });

  it('never trusts the address: odd values fall back to home or are ignored', () => {
    expect(parseHash('#/nonsense/whatever')).toEqual({ view: { kind: 'home' }, note: null });
    expect(parseHash('#/notebook/%E0%A4%A')).toEqual({ view: { kind: 'home' }, note: null }); // broken escape
    expect(parseHash('#/notebook/../../etc')).toMatchObject({ view: { kind: 'home' } });
    expect(parseHash(`#/notes/note/${encodeURIComponent('x'.repeat(200))}`)).toEqual({ view: { kind: 'all' }, note: null });
    expect(parseHash('#/notes/note/<script>')).toEqual({ view: { kind: 'all' }, note: null });
    expect(parseHash('#/note')).toEqual({ view: { kind: 'home' }, note: null });
  });
});
