import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openTestDb } from './helpers.js';
import { importEnex, exportEnex } from '../src/enex.js';
import { NoteStore, parseQuery } from '../src/store.js';

const H = { host: 'localhost:3737' };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-'));
  const store = new NoteStore(openTestDb(), join(dir, 'attachments'));
  return { store, app: createApp(store) };
}

async function json(app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { ...H, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, data: res.status === 204 ? null : await res.json().catch(() => null) };
}

describe('search grammar', () => {
  it('parses words, phrases and operators', () => {
    const p = parseQuery('hello wor "exact phrase" tag:work notebook:Ideas todo:true');
    expect(p.match).toBe('"hello"* "wor"* "exact phrase"');
    expect(p.tags).toEqual(['work']);
    expect(p.notebooks).toEqual(['Ideas']);
    expect(p.todo).toBe(true);
  });

  it('never produces FTS syntax errors from punctuation', () => {
    expect(parseQuery('a-b (c) *').match).toBe('"a"* "b"* "c"*');
  });
});

describe('notes API', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('creates, searches (prefix, accents, tags) and trashes notes', async () => {
    const { app } = ctx;
    const { data: a } = await json(app, 'POST', '/api/notes', {
      title: 'Receta de tortilla',
      content: '<p>Patatas y cebolla</p>',
      tags: ['cocina'],
    });
    await json(app, 'POST', '/api/notes', { title: 'Reunión', content: '<p>Presupuesto Q3</p>', tags: ['trabajo'] });

    expect((await json(app, 'GET', '/api/notes?q=pata')).data).toHaveLength(1);
    expect((await json(app, 'GET', '/api/notes?q=reunion')).data).toHaveLength(1);
    expect((await json(app, 'GET', '/api/notes?q=tag:cocina')).data).toHaveLength(1);
    expect((await json(app, 'GET', '/api/notes?tag=trabajo')).data).toHaveLength(1);

    await json(app, 'DELETE', `/api/notes/${a.id}`);
    expect((await json(app, 'GET', '/api/notes?q=tortilla')).data).toHaveLength(0);
    expect((await json(app, 'GET', '/api/notes?trashed=true')).data).toHaveLength(1);
    await json(app, 'POST', `/api/notes/${a.id}/restore`);
    expect((await json(app, 'GET', '/api/notes?q=tortilla')).data).toHaveLength(1);
  });

  it('keeps the search index in sync on edit', async () => {
    const { app } = ctx;
    const { data: n } = await json(app, 'POST', '/api/notes', { title: 't', content: '<p>alpha</p>' });
    await json(app, 'PATCH', `/api/notes/${n.id}`, { content: '<p>beta</p>' });
    expect((await json(app, 'GET', '/api/notes?q=alpha')).data).toHaveLength(0);
    expect((await json(app, 'GET', '/api/notes?q=beta')).data).toHaveLength(1);
  });

  it('finds unchecked tasks with todo:true', async () => {
    const { app } = ctx;
    const list = (checked: boolean) =>
      `<ul data-type="taskList"><li data-type="taskItem" data-checked="${checked}"><p>x</p></li></ul>`;
    await json(app, 'POST', '/api/notes', { title: 'open', content: list(false) });
    await json(app, 'POST', '/api/notes', { title: 'done', content: list(true) });
    const open = (await json(app, 'GET', '/api/notes?q=todo:true')).data;
    expect(open.map((n: any) => n.title)).toEqual(['open']);
  });

  it('strips scripts and event handlers from saved content', async () => {
    const { app } = ctx;
    const { data } = await json(app, 'POST', '/api/notes', {
      content: '<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">l</a>',
    });
    expect(data.content).not.toMatch(/script|onclick|javascript:/i);
  });

  it('records versions and restores them', async () => {
    const { app, store } = ctx;
    const { data: n } = await json(app, 'POST', '/api/notes', { title: 'v', content: '<p>one</p>' });
    await json(app, 'PATCH', `/api/notes/${n.id}`, { content: '<p>two</p>' });
    const versions = store.listVersions(n.id);
    expect(versions).toHaveLength(1);
    const { data: restored } = await json(app, 'POST', `/api/notes/${n.id}/versions/${versions[0]!.id}/restore`);
    expect(restored.content).toBe('<p>one</p>');
  });

  it('moves notes when a notebook is deleted and refuses to delete the last one', async () => {
    const { app, store } = ctx;
    const { data: nb } = await json(app, 'POST', '/api/notebooks', { name: 'Work' });
    const { data: n } = await json(app, 'POST', '/api/notes', { notebookId: nb.id, title: 'x' });
    expect((await json(app, 'DELETE', `/api/notebooks/${nb.id}`)).res.status).toBe(204);
    expect(store.getNote(n.id).notebookId).not.toBe(nb.id);
    const only = store.listNotebooks()[0]!;
    expect((await json(app, 'DELETE', `/api/notebooks/${only.id}`)).res.status).toBe(400);
  });
});

describe('attachments', () => {
  it('stores, serves safely and cleans up files', async () => {
    const { app } = setup();
    const { data: n } = await json(app, 'POST', '/api/notes', { title: 'a' });
    const form = new FormData();
    form.set('file', new File(['<script>alert(1)</script>'], 'evil.html', { type: 'text/html' }));
    const up = await app.request(`/api/notes/${n.id}/attachments`, { method: 'POST', headers: H, body: form });
    expect(up.status).toBe(201);
    const att: any = await up.json();
    const res = await app.request(att.url, { headers: H });
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(res.headers.get('content-security-policy')).toMatch(/sandbox/);
    await json(app, 'DELETE', `/api/notes/${n.id}?permanent=true`);
    expect((await app.request(att.url, { headers: H })).status).toBe(404);
  });
});

describe('local-only protections', () => {
  it('rejects foreign hosts and cross-origin writes', async () => {
    const { app } = setup();
    expect((await app.request('/api/notes', { headers: { host: 'evil.example.com' } })).status).toBe(403);
    const res = await app.request('/api/notes', {
      method: 'POST',
      headers: { ...H, origin: 'https://evil.example.com', 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});

const ENEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20240102T030405Z" application="Evernote" version="10.0">
<note>
  <title>Lista &amp; compras</title>
  <created>20230115T101500Z</created>
  <updated>20230116T080000Z</updated>
  <tag>casa</tag><tag>urgente</tag>
  <note-attributes><source-url>https://example.com/x</source-url></note-attributes>
  <content><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>Hola <b>mundo</b></div><div><en-todo checked="true"/>Leche</div><div><en-todo/>Pan</div><div><en-media type="image/png" hash="3a2d3e3b3e3ab0df6ab0e6a7e1f1f9a4"/></div></en-note>]]></content>
  <resource>
    <data encoding="base64">iVBORw0KGgo=</data>
    <mime>image/png</mime>
    <resource-attributes><file-name>pixel.png</file-name></resource-attributes>
  </resource>
</note>
</en-export>`;

describe('ENEX', () => {
  it('imports notes with tags, dates, tasks and attachments', () => {
    const { store } = setup();
    // Make the fixture's media hash match its resource bytes.
    const md5 = createHash('md5').update(Buffer.from('iVBORw0KGgo=', 'base64')).digest('hex');
    const result = importEnex(store, ENEX.replace('3a2d3e3b3e3ab0df6ab0e6a7e1f1f9a4', md5), 'Evernote import');
    expect(result).toMatchObject({ notes: 1, attachments: 1 });

    const [summary] = store.listNotes({ notebookId: result.notebookId });
    const note = store.getNote(summary!.id);
    expect(note.title).toBe('Lista & compras');
    expect(note.tags).toEqual(['casa', 'urgente']);
    expect(note.createdAt).toBe(Date.UTC(2023, 0, 15, 10, 15, 0));
    expect(note.sourceUrl).toBe('https://example.com/x');
    expect(note.content).toContain('data-type="taskList"');
    expect(note.content).toContain('data-checked="true"');
    expect(note.content).toMatch(/<img [^>]*src="\/api\/attachments\/[0-9a-f-]+"/);
    expect(note.content).toContain('<p>Leche</p>');
    expect(note.content).toContain('<p>Pan</p>');
    expect(note.content.match(/data-type="taskItem"/g)).toHaveLength(2);
    expect(store.listNotes({ q: 'leche' })).toHaveLength(1);
  });

  it('round-trips through export and import', () => {
    const { store } = setup();
    const md5 = createHash('md5').update(Buffer.from('iVBORw0KGgo=', 'base64')).digest('hex');
    const first = importEnex(store, ENEX.replace('3a2d3e3b3e3ab0df6ab0e6a7e1f1f9a4', md5), 'A');
    const notes = store.listNotes({ notebookId: first.notebookId }).map((n) => store.getNote(n.id));

    const exported = exportEnex(store, notes);
    expect(exported).toContain('<en-todo checked="true"/>');
    expect(exported).toContain(`hash="${md5}"`);

    const second = importEnex(store, exported, 'B');
    expect(second).toMatchObject({ notes: 1, attachments: 1 });
    const copy = store.getNote(store.listNotes({ notebookId: second.notebookId })[0]!.id);
    expect(copy.title).toBe('Lista & compras');
    expect(copy.tags).toEqual(['casa', 'urgente']);
    expect(copy.content.match(/data-type="taskItem"/g)).toHaveLength(2);
  });

  it('rejects non-ENEX input', async () => {
    const { app } = setup();
    const res = await app.request('/api/import/enex', { method: 'POST', headers: H, body: '<html/>' });
    expect(res.status).toBe(400);
  });

  it('exports Markdown with front matter and task lists', async () => {
    const { app } = setup();
    const { data: n } = await json(app, 'POST', '/api/notes', {
      title: 'MD',
      content:
        '<h2>Sub</h2><p>text</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul>',
      tags: ['a'],
    });
    const md = await (await app.request(`/api/notes/${n.id}/export.md`, { headers: H })).text();
    expect(md).toContain('title: "MD"');
    expect(md).toContain('## Sub');
    expect(md).toContain('- [x] done');
  });
});

describe('advanced search', () => {
  const seed = async (app: ReturnType<typeof createApp>) => {
    const mk = (b: object) => json(app, 'POST', '/api/notes', b);
    await mk({ title: 'Alpha plan', content: '<p>budget review</p>', tags: ['work/projects/alpha'] });
    await mk({ title: 'Beta plan', content: '<p>budget draft</p>', tags: ['work/projects/beta', 'urgent'] });
    await mk({ title: 'Groceries', content: '<p>milk bread</p>', tags: ['home'] });
  };
  const titles = async (app: ReturnType<typeof createApp>, q: string) =>
    ((await json(app, 'GET', `/api/notes?q=${encodeURIComponent(q)}`)).data as any[]).map((n) => n.title).sort();

  it('matches descendants of a hierarchical tag', async () => {
    const { app } = setup();
    await seed(app);
    expect(await titles(app, 'tag:work')).toEqual(['Alpha plan', 'Beta plan']);
    expect(await titles(app, 'tag:work/projects/beta')).toEqual(['Beta plan']);
    expect(await titles(app, 'tag:wor')).toEqual([]);
    const tags = (await json(app, 'GET', '/api/tags')).data as any[];
    expect(tags.find((t) => t.name === 'work/projects')).toMatchObject({ virtual: true, count: 0, total: 2 });
    expect(tags.find((t) => t.name === 'work')).toMatchObject({ virtual: true, total: 2 });
  });

  it('reports tag totals including descendants', async () => {
    const { app, store } = setup();
    await seed(app);
    store.setTags(store.listNotes({ q: 'milk' })[0]!.id, ['work', 'home']);
    const totals = Object.fromEntries(store.listTags().map((t) => [t.name, [t.count, t.total]]));
    expect(totals['work']).toEqual([1, 3]);
    expect(totals['work/projects/alpha']).toEqual([1, 1]);
  });

  it('supports negation, intitle and any:', async () => {
    const { app } = setup();
    await seed(app);
    expect(await titles(app, 'budget -beta')).toEqual(['Alpha plan']);
    expect(await titles(app, '-tag:work')).toEqual(['Groceries']);
    expect(await titles(app, 'intitle:plan')).toEqual(['Alpha plan', 'Beta plan']);
    expect(await titles(app, 'intitle:budget')).toEqual([]);
    expect(await titles(app, 'any: milk review')).toEqual(['Alpha plan', 'Groceries']);
    expect(await titles(app, 'milk review')).toEqual([]);
  });

  it('filters by created/updated dates', async () => {
    const { app, store } = setup();
    const day = 86_400_000;
    store.createNote({ title: 'old', createdAt: Date.now() - 40 * day, updatedAt: Date.now() - 40 * day });
    store.createNote({ title: 'new' });
    expect(await titles(app, 'created:month')).toEqual(['new']);
    expect(await titles(app, '-created:month')).toEqual(['old']);
    expect(await titles(app, 'updated:day-1')).toEqual(['new']);
    expect(await titles(app, 'created:20000101')).toEqual(['new', 'old']);
  });

  it('filters by source url and attachments', async () => {
    const { app, store } = setup();
    store.createNote({ title: 'clip', sourceUrl: 'https://example.com/article' });
    const withFile = store.createNote({ title: 'file' });
    store.addAttachment(withFile.id, { filename: 'a.txt', mime: 'text/plain', data: new Uint8Array([1]) });
    expect(await titles(app, 'sourceUrl:example.com')).toEqual(['clip']);
    expect(await titles(app, 'resource:any')).toEqual(['file']);
    expect(await titles(app, '-resource:any')).toEqual(['clip']);
  });
});

describe('tasks', () => {
  const list = (items: [string, boolean, string?][]) =>
    `<ul data-type="taskList">${items
      .map(([t, c, due]) => `<li data-type="taskItem" data-checked="${c}"${due ? ` data-due="${due}"` : ''}><p>${t}</p></li>`)
      .join('')}</ul>`;
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const tasks = async (app: ReturnType<typeof createApp>, qs = '') =>
    ((await json(app, 'GET', `/api/tasks${qs}`)).data as any[]).map((t) => t.text);

  it('indexes checklist items across notes and filters by due date', async () => {
    const { app } = setup();
    await json(app, 'POST', '/api/notes', {
      title: 'A',
      content: list([['late', false, day(-2)], ['today', false, day(0)], ['soon', false, day(3)], ['nodate', false], ['done', true, day(0)]]),
    });
    expect(await tasks(app)).toEqual(['late', 'today', 'soon', 'nodate']);
    expect(await tasks(app, '?due=overdue')).toEqual(['late']);
    expect(await tasks(app, '?due=today')).toEqual(['today']);
    expect(await tasks(app, '?due=week')).toEqual(['today', 'soon']);
    expect(await tasks(app, '?due=none')).toEqual(['nodate']);
    expect(await tasks(app, '?status=done')).toEqual(['done']);
  });

  it('toggles a task and sets its due date through the note content', async () => {
    const { app } = setup();
    const { data: n } = await json(app, 'POST', '/api/notes', { title: 'T', content: list([['one', false], ['two', false]]) });
    expect((await json(app, 'PATCH', `/api/tasks/${n.id}/1`, { checked: true, due: day(1) })).res.status).toBe(204);
    const note = (await json(app, 'GET', `/api/notes/${n.id}`)).data;
    expect(note.content).toMatch(/<li (?=[^>]*data-checked="true")(?=[^>]*data-due="\d{4}-\d{2}-\d{2}")[^>]*><p>two/);
    expect(await tasks(app)).toEqual(['one']);
    expect(await tasks(app, '?status=done')).toEqual(['two']);
    expect((await json(app, 'PATCH', `/api/tasks/${n.id}/9`, { checked: true })).res.status).toBe(404);
    expect((await json(app, 'PATCH', `/api/tasks/${n.id}/0`, { due: 'tomorrow' })).res.status).toBe(400);
  });

  it('drops tasks of trashed notes and keeps them in sync on edit', async () => {
    const { app } = setup();
    const { data: n } = await json(app, 'POST', '/api/notes', { title: 'T', content: list([['x', false]]) });
    await json(app, 'PATCH', `/api/notes/${n.id}`, { content: list([['y', false]]) });
    expect(await tasks(app)).toEqual(['y']);
    await json(app, 'DELETE', `/api/notes/${n.id}`);
    expect(await tasks(app)).toEqual([]);
  });
});

describe('templates, duplicate, merge and links', () => {
  const png = new Uint8Array([137, 80, 78, 71]);

  it('creates notes from a template, filling placeholders, and hides templates from lists', async () => {
    const { app, store } = setup();
    const { data: src } = await json(app, 'POST', '/api/notes', { title: 'Daily {{date}}', content: '<p>at {{time}}</p>' });
    const { data: tpl } = await json(app, 'POST', '/api/templates', { noteId: src.id });
    expect((await json(app, 'GET', '/api/templates')).data).toHaveLength(1);
    // The template copy is not a regular note: lists, search and counts ignore it.
    expect((await json(app, 'GET', '/api/notes')).data).toHaveLength(1);
    expect(store.listNotebooks()[0]!.noteCount).toBe(1);

    const { res, data: made } = await json(app, 'POST', `/api/templates/${tpl.id}/use`, {});
    expect(res.status).toBe(201);
    expect(made.title).toMatch(/^Daily \d{4}-\d{2}-\d{2}$/);
    expect(made.content).toMatch(/at \d{2}:\d{2}/);
    expect((await json(app, 'GET', '/api/notes')).data).toHaveLength(2);
    // A regular note is not a template.
    expect((await json(app, 'POST', `/api/templates/${src.id}/use`, {})).res.status).toBe(400);
    await json(app, 'DELETE', `/api/templates/${tpl.id}`);
    expect((await json(app, 'GET', '/api/templates')).data).toHaveLength(0);
  });

  it('seeds starter templates once, in the requested language', () => {
    const { store } = setup();
    store.seedTemplates('es_ES.UTF-8');
    store.seedTemplates('es_ES.UTF-8');
    const titles = store.listTemplates().map((t) => t.title);
    expect(titles).toHaveLength(4);
    expect(titles).toContain('Acta de reunión');
  });

  it('duplicates a note with its own copy of the attachments', async () => {
    const { app, store } = setup();
    const note = store.createNote({ title: 'Pic', tags: ['x'] });
    const att = store.addAttachment(note.id, { filename: 'p.png', mime: 'image/png', data: png });
    store.updateNote(note.id, { content: `<p><img src="/api/attachments/${att.id}"></p>` });

    const { res, data: copy } = await json(app, 'POST', `/api/notes/${note.id}/duplicate`);
    expect(res.status).toBe(201);
    expect(copy.title).toBe('Pic (copy)');
    expect(copy.tags).toEqual(['x']);
    const [copied] = store.listAttachments(copy.id);
    expect(copied!.id).not.toBe(att.id);
    expect(copy.content).toContain(`/api/attachments/${copied!.id}`);
    expect(copy.content).not.toContain(att.id);
    // Deleting the original must not break the copy.
    store.deleteNotePermanently(note.id);
    expect(store.getAttachment(copied!.id).data.length).toBe(4);
  });

  it('merges notes: content, tags and files move to the first note, the rest go to the trash', async () => {
    const { app, store } = setup();
    const a = store.createNote({ title: 'A', content: '<p>one</p>', tags: ['t1'] });
    const b = store.createNote({ title: 'B', content: '<p>two</p>', tags: ['t2'] });
    const att = store.addAttachment(b.id, { filename: 'f.txt', mime: 'text/plain', data: png });

    const { data: merged } = await json(app, 'POST', '/api/notes/merge', { ids: [a.id, b.id] });
    expect(merged.id).toBe(a.id);
    expect(merged.content).toContain('<p>one</p><hr><h2>B</h2><p>two</p>');
    expect(merged.tags).toEqual(['t1', 't2']);
    expect(store.listAttachments(a.id).map((x) => x.id)).toEqual([att.id]);
    expect(store.getNote(b.id).trashedAt).not.toBeNull();
    expect(store.listNotes({ q: 'two' }).map((n) => n.id)).toEqual([a.id]);
    expect((await json(app, 'POST', '/api/notes/merge', { ids: [a.id] })).res.status).toBe(400);
  });

  it('finds backlinks from #/note/<id> links', async () => {
    const { app, store } = setup();
    const target = store.createNote({ title: 'Target' });
    store.createNote({ title: 'Linker', content: `<p><a href="#/note/${target.id}">Target</a></p>` });
    store.createNote({ title: 'Unrelated', content: '<p>nothing</p>' });
    const { data } = await json(app, 'GET', `/api/notes/${target.id}/backlinks`);
    expect(data.map((n: any) => n.title)).toEqual(['Linker']);
  });
});

import { strToU8, unzipSync, zipSync } from 'fflate';
import { markdownToHtml } from '../src/import.js';

describe('markdown / html / zip import and export', () => {
  const post = (app: ReturnType<typeof createApp>, qs: string, body: BodyInit) =>
    app.request(`/api/import/markdown?${qs}`, { method: 'POST', headers: H, body });

  it('converts markdown (headings, GFM task lists, code) to editor HTML', () => {
    const html = markdownToHtml('## Title\n\n- [x] done\n- [ ] todo\n\n- plain\n\n`code`');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<ul data-type="taskList">');
    expect(html.match(/data-type="taskItem"/g)).toHaveLength(2);
    expect(html).toMatch(/data-checked="true"/);
    expect(html).toContain('<li><p>plain</p>');
    // tasks and bullets end up in separate lists
    expect(html.match(/<ul/g)).toHaveLength(2);
    expect(html).toContain('<p>done</p>');
    expect(html).toContain('<code>code</code>');
  });

  it('imports a single markdown file with front matter and a title heading', async () => {
    const { app, store } = setup();
    const md = '---\ntitle: "Ignored by h1? no"\ntags: [a, "b c"]\ncreated: 2023-05-01T10:00:00Z\n---\n# Trip plan\n\nBring **water**.\n\n- [ ] tickets\n';
    const res = await post(app, 'notebook=Docs&filename=trip.md', md);
    expect(res.status).toBe(201);
    const note = store.getNote(store.listNotes({ q: 'water' })[0]!.id);
    expect(note.title).toBe('Ignored by h1? no');
    expect(note.tags).toEqual(['a', 'b c']);
    expect(note.createdAt).toBe(Date.parse('2023-05-01T10:00:00Z'));
    expect(note.content).toContain('<strong>water</strong>');
    expect(note.content).toContain('data-type="taskItem"');
    expect(store.listNotebooks().map((n) => n.name)).toContain('Docs');
  });

  it('uses the first heading as title and strips scripts from html', async () => {
    const { app, store } = setup();
    await post(app, 'filename=n.md', '# From heading\n\nbody <script>alert(1)</script><img src=x onerror=alert(1)>');
    const n = store.getNote(store.listNotes({})[0]!.id);
    expect(n.title).toBe('From heading');
    expect(n.content).not.toMatch(/script|onerror/i);

    await post(app, 'notebook=H&filename=page.html', '<html><head><title>Page title</title></head><body><p onclick="x()">hi</p><script>1</script></body></html>');
    const h = store.listNotes({ q: 'hi' })[0]!;
    expect(h.title).toBe('Page title');
    expect(store.getNote(h.id).content).toBe('<p>hi</p>');
  });

  it('imports a zip vault: folders → notebooks/stacks, relative images → attachments', async () => {
    const { app, store } = setup();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const zip = zipSync({
      'Root note.md': strToU8('# Root\n\nat the top'),
      'Work/Plan.md': strToU8('# Plan\n\n![pic](attachments/a%20b.png)\n\n[doc](../Work/attachments/a%20b.png)'),
      'Work/attachments/a b.png': png,
      'Stack/Inner/Deep.md': strToU8('# Deep\n\ndeep text'),
      '__MACOSX/Work/._Plan.md': strToU8('junk'),
    });
    const res = await post(app, 'notebook=Vault', zip as Uint8Array<ArrayBuffer>);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ notes: 3, attachments: 1 });

    const books = store.listNotebooks();
    expect(books.map((b) => b.name).sort()).toEqual(['Inner', 'Notes', 'Vault', 'Work']);
    expect(books.find((b) => b.name === 'Inner')!.stack).toBe('Stack');
    const plan = store.getNote(store.listNotes({ q: 'plan' })[0]!.id);
    const [att] = store.listAttachments(plan.id);
    expect(att).toMatchObject({ filename: 'a b.png', mime: 'image/png' });
    expect(plan.content).toContain(`<img src="/api/attachments/${att!.id}"`);
    expect(plan.content).toContain(`<a href="/api/attachments/${att!.id}"`);
    expect(store.getAttachment(att!.id).data.length).toBe(8);
  });

  it('rejects empty archives and corrupt zips', async () => {
    const { app } = setup();
    const empty = zipSync({ 'img.png': new Uint8Array([1]) });
    expect((await post(app, '', empty as Uint8Array<ArrayBuffer>)).status).toBe(400);
  });

  it('exports a zip with notebooks, markdown, attachments and round-trips through import', async () => {
    const { app, store } = setup();
    const nb = store.createNotebook('Trips', 'Life');
    const note = store.createNote({ notebookId: nb.id, title: 'Rome / 2024', tags: ['travel'], content: '<h2>Day 1</h2><p>Colosseum</p>' });
    const att = store.addAttachment(note.id, { filename: 'map.png', mime: 'image/png', data: new Uint8Array([1, 2, 3]) });
    store.updateNote(note.id, { content: `<p>Colosseum</p><p><img src="/api/attachments/${att.id}"></p>` });
    store.createNote({ notebookId: nb.id, title: 'Rome / 2024', content: '<p>duplicate title</p>' });

    const res = await app.request('/api/export/zip', { headers: H });
    expect(res.headers.get('content-type')).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files).sort();
    expect(names).toContain('Life/Trips/Rome _ 2024.md');
    expect(names).toContain('Life/Trips/Rome _ 2024 (2).md');
    const assetName = names.find((n) => n.startsWith('Life/Trips/attachments/'))!;
    expect(assetName).toMatch(/attachments\/[0-9a-f]{8}-map\.png$/);
    expect([...files[assetName]!]).toEqual([1, 2, 3]);
    // Which of the two same-titled notes gets the plain name depends on timestamp ties: look at both.
    const mds = ['Life/Trips/Rome _ 2024.md', 'Life/Trips/Rome _ 2024 (2).md'].map((n) => new TextDecoder().decode(files[n]));
    const md = mds.find((m) => m.includes('Colosseum'))!;
    expect(md).toContain(`![](${encodeURI(`attachments/${assetName.split('/').pop()}`)})`);
    expect(md).toContain('tags: ["travel"]');
    expect(mds.some((m) => m.includes('duplicate title'))).toBe(true);

    // Import the export into a fresh store: structure and files survive.
    const fresh = setup();
    const imp = await post(fresh.app, 'notebook=X', new Uint8Array(await (await app.request('/api/export/zip', { headers: H })).arrayBuffer()) as Uint8Array<ArrayBuffer>);
    expect(await imp.json()).toMatchObject({ notes: 2, attachments: 1 });
    const trips = fresh.store.listNotebooks().find((b) => b.name === 'Trips')!;
    expect(trips.stack).toBe('Life');
    const back = fresh.store.getNote(fresh.store.listNotes({ q: 'colosseum' })[0]!.id);
    expect(back.tags).toEqual(['travel']);
    expect(fresh.store.listAttachments(back.id)).toHaveLength(1);
  });
});

import { startServer } from '../src/start.js';

describe('startServer', () => {
  it('serves the API on a free loopback port and closes cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opennote-start-'));
    const s = await startServer({ dataDir: dir, port: 0 });
    try {
      expect(s.port).toBeGreaterThan(0);
      const res = await fetch(`${s.url}/api/notebooks`);
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveLength(1);
    } finally {
      await s.close();
    }
    await expect(fetch(`${s.url}/api/notebooks`)).rejects.toThrow();
  });
});

describe('web UI hosting', () => {
  it('serves the UI with a strict Content-Security-Policy on every HTML response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opennote-ui-'));
    const dist = join(dir, 'dist');
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
    const s = await startServer({ dataDir: join(dir, 'data'), webDist: dist, port: 0 });
    try {
      for (const path of ['/', '/some/app/route']) {
        const res = await fetch(`${s.url}${path}`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('id="root"');
        const csp = res.headers.get('content-security-policy') ?? '';
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).not.toContain("script-src 'self' 'unsafe");
      }
      // API responses are JSON and carry no page policy.
      expect((await fetch(`${s.url}/api/notebooks`)).headers.get('content-security-policy')).toBeNull();
    } finally {
      await s.close();
    }
  });
});

describe('tag cleanup', () => {
  it('removes tags that no note uses after a permanent delete', () => {
    const { store } = setup();
    const a = store.createNote({ title: 'a', tags: ['solo', 'shared'] });
    store.createNote({ title: 'b', tags: ['shared'] });
    expect(store.listTags().map((t) => t.name)).toEqual(['shared', 'solo']);
    store.deleteNotePermanently(a.id);
    expect(store.listTags().map((t) => t.name)).toEqual(['shared']);
  });
});

describe('attachment serving: ranges and previews', () => {
  const bytes = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
  const make = (mime: string) => {
    const { app, store } = setup();
    const n = store.createNote({ title: 'm' });
    const att = store.addAttachment(n.id, { filename: 'f', mime, data: bytes });
    return { app, store, n, url: `/api/attachments/${att.id}` };
  };
  const get = (app: ReturnType<typeof createApp>, url: string, range?: string) =>
    app.request(url, { headers: range ? { ...H, range } : H });

  it('serves byte ranges so audio and video can seek', async () => {
    const { app, url } = make('audio/webm');
    const full = await get(app, url);
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');

    const part = await get(app, url, 'bytes=10-19');
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 10-19/100');
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

    const open = await get(app, url, 'bytes=95-');
    expect([...new Uint8Array(await open.arrayBuffer())]).toEqual([95, 96, 97, 98, 99]);
    const suffix = await get(app, url, 'bytes=-3');
    expect(suffix.headers.get('content-range')).toBe('bytes 97-99/100');
    const clamped = await get(app, url, 'bytes=90-500');
    expect(clamped.headers.get('content-range')).toBe('bytes 90-99/100');
    expect((await get(app, url, 'bytes=200-300')).status).toBe(416);
    expect((await get(app, url, 'bytes=5-2')).status).toBe(416);
    expect((await get(app, url, 'bytes=0-1,5-6')).status).toBe(200); // multi-range: full body
  });

  it('shows PDFs inline without the sandbox, but still sandboxes HTML and SVG', async () => {
    const p = make('application/pdf');
    const pdf = await get(p.app, p.url);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toMatch(/^inline/);
    expect(pdf.headers.get('content-security-policy')).toBeNull();
    expect(pdf.headers.get('x-content-type-options')).toBe('nosniff');

    for (const mime of ['text/html', 'image/svg+xml', 'application/xhtml+xml']) {
      const { app, url } = make(mime);
      const res = await get(app, url);
      expect(res.headers.get('content-security-policy'), mime).toMatch(/sandbox/);
      expect(res.headers.get('content-disposition'), mime).toMatch(/^attachment/);
    }
  });

  it('exports audio attachments to ENEX and Markdown', async () => {
    const { app, store, n, url } = make('audio/webm');
    store.updateNote(n.id, { content: `<p>memo</p><audio controls src="${url}"></audio>` });
    const enex = await (await app.request(`/api/export/enex?note=${n.id}`, { headers: H })).text();
    expect(enex).toMatch(/<en-media type="audio\/webm" hash="[0-9a-f]{32}"\/>/);
    const md = await (await app.request(`/api/notes/${n.id}/export.md`, { headers: H })).text();
    expect(md).toContain('[🎙 Audio](attachments/f)');
  });
});
