import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { importEnex, exportEnex } from '../src/enex.js';
import { NoteStore, parseQuery } from '../src/store.js';

const H = { host: 'localhost:3737' };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-'));
  const store = new NoteStore(openDb(':memory:'), join(dir, 'attachments'));
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
