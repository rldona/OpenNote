import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { NoteStore } from '../src/store.js';
import { SyncEngine, SyncError, compareVV } from '../src/sync.js';

let shared: string;

function device(name: string, passphrase?: string) {
  const dataDir = mkdtempSync(join(tmpdir(), `opennote-dev-${name}-`));
  const store = new NoteStore(openDb(':memory:'), join(dataDir, 'attachments'));
  const engine = new SyncEngine(store, { dataDir, deviceName: name });
  engine.setConfig({ folder: shared, enabled: true, passphrase: passphrase ?? null });
  return { name, store, engine, dataDir, sync: () => engine.run() };
}
type Dev = ReturnType<typeof device>;

const titles = (d: Dev) => d.store.listNotes({}).map((n) => n.title).sort();
const bodyOf = (d: Dev, id: string) => d.store.getNote(id).content;
const noteDir = (id: string) => join(shared, 'opennote-sync', 'notes', id);

beforeEach(() => {
  shared = mkdtempSync(join(tmpdir(), 'opennote-shared-'));
});

describe('version vectors', () => {
  it('orders, equals and detects concurrency', () => {
    expect(compareVV({ a: 1 }, { a: 1 })).toBe('equal');
    expect(compareVV({ a: 2 }, { a: 1 })).toBe('after');
    expect(compareVV({ a: 1 }, { a: 1, b: 1 })).toBe('before');
    expect(compareVV({ a: 2 }, { b: 1 })).toBe('concurrent');
    expect(compareVV({}, {})).toBe('equal');
  });
});

describe('sync folder', () => {
  it('propagates new notes with notebook, tags, pin and attachments', async () => {
    const a = device('A');
    const b = device('B');
    const nb = a.store.createNotebook('Trips', 'Life');
    const n = a.store.createNote({ notebookId: nb.id, title: 'Rome', content: '<p>Colosseum</p>', tags: ['travel/italy'], pinned: true });
    const att = a.store.addAttachment(n.id, { filename: 'map.png', mime: 'image/png', data: new Uint8Array([1, 2, 3, 4]) });
    a.store.updateNote(n.id, { content: `<p>Colosseum</p><img src="/api/attachments/${att.id}">` });

    const ra = await a.sync();
    expect(ra).toMatchObject({ ok: true, pushed: 1 });
    const rb = await b.sync();
    expect(rb).toMatchObject({ ok: true, pulled: 1 });

    const got = b.store.getNote(n.id);
    expect(got).toMatchObject({ title: 'Rome', pinned: true, tags: ['travel/italy'] });
    const book = b.store.listNotebooks().find((x) => x.id === got.notebookId)!;
    expect(book).toMatchObject({ name: 'Trips', stack: 'Life' });
    expect([...b.store.attachmentData(att.id)]).toEqual([1, 2, 3, 4]);
    expect(b.store.listNotes({ q: 'colosseum' })).toHaveLength(1);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const a = device('A');
    const b = device('B');
    a.store.createNote({ title: 'x', content: '<p>one</p>' });
    await a.sync();
    await b.sync();
    expect(await a.sync()).toMatchObject({ pushed: 0, pulled: 0, deleted: 0 });
    expect(await b.sync()).toMatchObject({ pushed: 0, pulled: 0, deleted: 0 });
    const files = readdirSync(noteDir(a.store.listNotes({})[0]!.id));
    expect(files).toHaveLength(1); // B never rewrote what it only received
  });

  it('propagates edits both ways, trash and permanent deletion', async () => {
    const a = device('A');
    const b = device('B');
    const n = a.store.createNote({ title: 'doc', content: '<p>v1</p>' });
    await a.sync();
    await b.sync();

    b.store.updateNote(n.id, { content: '<p>v2 from B</p>' });
    await b.sync();
    await a.sync();
    expect(bodyOf(a, n.id)).toBe('<p>v2 from B</p>');

    a.store.trashNote(n.id);
    await a.sync();
    await b.sync();
    expect(b.store.getNote(n.id).trashedAt).not.toBeNull();

    b.store.deleteNotePermanently(n.id);
    await b.sync();
    expect(await a.sync()).toMatchObject({ deleted: 1 });
    expect(a.store.hasNote(n.id)).toBe(false);
    // Nobody resurrects it afterwards.
    await a.sync();
    await b.sync();
    expect(a.store.hasNote(n.id)).toBe(false);
    expect(b.store.hasNote(n.id)).toBe(false);
  });

  it('keeps both versions when two devices edit the same note', async () => {
    const a = device('A');
    const b = device('B');
    const n = a.store.createNote({ title: 'plan', content: '<p>base</p>' });
    await a.sync();
    await b.sync();

    a.store.updateNote(n.id, { content: '<p>edit by A</p>', updatedAt: 2_000 });
    b.store.updateNote(n.id, { content: '<p>edit by B</p>', updatedAt: 3_000 });
    await a.sync();
    const rb = await b.sync();
    expect(rb.conflicts).toHaveLength(1);
    await a.sync();
    await b.sync();
    await a.sync();

    // B is newer so it owns the note; A's text survives as a conflict copy on both devices.
    for (const d of [a, b]) {
      expect(bodyOf(d, n.id)).toBe('<p>edit by B</p>');
      const copies = d.store.listNotes({}).filter((x) => x.title.includes('conflict'));
      expect(copies).toHaveLength(1);
      expect(copies[0]!.title).toMatch(/^plan \(conflict A \d{4}-\d{2}-\d{2}\)$/);
      expect(d.store.getNote(copies[0]!.id).content).toBe('<p>edit by A</p>');
    }
    expect(titles(a)).toEqual(titles(b));
    // And it is stable.
    expect(await a.sync()).toMatchObject({ pushed: 0, pulled: 0, conflicts: [] });
    expect(await b.sync()).toMatchObject({ pushed: 0, pulled: 0, conflicts: [] });
  });

  it('conflict copies carry their own attachments', async () => {
    const a = device('A');
    const b = device('B');
    const n = a.store.createNote({ title: 'pic', content: '<p>base</p>' });
    await a.sync();
    await b.sync();
    const att = a.store.addAttachment(n.id, { filename: 'a.png', mime: 'image/png', data: new Uint8Array([9, 9]) });
    a.store.updateNote(n.id, { content: `<img src="/api/attachments/${att.id}">`, updatedAt: 2_000 });
    b.store.updateNote(n.id, { content: '<p>B wins</p>', updatedAt: 3_000 });
    await a.sync();
    await b.sync();
    const copy = b.store.listNotes({}).find((x) => x.title.includes('conflict'))!;
    const [copied] = b.store.listAttachments(copy.id);
    expect(copied).toBeDefined();
    expect(copied!.id).not.toBe(att.id);
    expect(b.store.getNote(copy.id).content).toContain(copied!.id);
    expect([...b.store.attachmentData(copied!.id)]).toEqual([9, 9]);
  });

  it('an edit beats a concurrent deletion', async () => {
    const a = device('A');
    const b = device('B');
    const n = a.store.createNote({ title: 'keep me', content: '<p>x</p>' });
    await a.sync();
    await b.sync();
    b.store.deleteNotePermanently(n.id);
    a.store.updateNote(n.id, { content: '<p>edited</p>', updatedAt: 5_000 });
    await a.sync();
    await b.sync(); // B sees A's concurrent edit and brings the note back
    await a.sync();
    expect(bodyOf(b, n.id)).toBe('<p>edited</p>');
    expect(bodyOf(a, n.id)).toBe('<p>edited</p>');
  });

  it('three devices converge', async () => {
    const [a, b, c] = [device('A'), device('B'), device('C')] as [Dev, Dev, Dev];
    a.store.createNote({ title: 'from A' });
    b.store.createNote({ title: 'from B' });
    c.store.createNote({ title: 'from C' });
    for (let i = 0; i < 2; i++) for (const d of [a, b, c]) await d.sync();
    expect(titles(a)).toEqual(['from A', 'from B', 'from C']);
    expect(titles(b)).toEqual(titles(a));
    expect(titles(c)).toEqual(titles(a));
  });

  it('does not sync built-in templates, but syncs user templates', async () => {
    const a = device('A');
    const b = device('B');
    a.store.seedTemplates('en');
    b.store.seedTemplates('es');
    const n = a.store.createNote({ title: 'My template', content: '<p>x</p>' });
    a.store.saveAsTemplate(n.id);
    await a.sync();
    await b.sync();
    expect(b.store.listTemplates().map((t) => t.title).sort()).toEqual(
      ['Acta de reunión', 'Lista de tareas', 'My template', 'Plan de proyecto', 'Revisión semanal'],
    );
  });

  it('ignores half-synced and corrupt files and picks them up later', async () => {
    const a = device('A');
    const b = device('B');
    const n = a.store.createNote({ title: 'late', content: '<p>x</p>' });
    await a.sync();
    const file = join(noteDir(n.id), `${a.engine.deviceId}.json`);
    const good = readFileSync(file);
    writeFileSync(file, good.subarray(0, good.length / 2)); // truncated, as a sync tool mid-transfer
    const first = await b.sync();
    expect(first.ok).toBe(true);
    expect(b.store.hasNote(n.id)).toBe(false);
    writeFileSync(file, good);
    await b.sync();
    expect(b.store.hasNote(n.id)).toBe(true);

    // A record whose checksum does not match is never trusted either.
    const tampered = JSON.parse(good.toString());
    tampered.note.title = 'tampered';
    writeFileSync(file, JSON.stringify(tampered));
    const c = device('C');
    await c.sync();
    expect(c.store.hasNote(n.id)).toBe(false);
  });

  it('waits for attachment bytes before applying a note', async () => {
    const a = device('A');
    const b = device('B');
    const n = a.store.createNote({ title: 'with file' });
    a.store.addAttachment(n.id, { filename: 'f.bin', mime: 'application/octet-stream', data: new Uint8Array([7, 7, 7]) });
    await a.sync();
    const blobDir = join(shared, 'opennote-sync', 'attachments');
    const [blob] = readdirSync(blobDir);
    const bytes = readFileSync(join(blobDir, blob!));
    writeFileSync(join(blobDir, blob!), Buffer.from([1])); // wrong content, as if still downloading
    await b.sync();
    expect(b.store.hasNote(n.id)).toBe(false);
    writeFileSync(join(blobDir, blob!), bytes);
    await b.sync();
    expect(b.store.hasNote(n.id)).toBe(true);
  });

  it('encrypts notes and attachments with a passphrase', async () => {
    const a = device('A', 'correct horse');
    const n = a.store.createNote({ title: 'Secret title', content: '<p>top secret body</p>' });
    a.store.addAttachment(n.id, { filename: 'secret.txt', mime: 'text/plain', data: new TextEncoder().encode('plain attachment bytes') });
    expect(await a.sync()).toMatchObject({ ok: true, pushed: 1 });

    const all = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(dir, e.name)) : [join(dir, e.name)]));
    for (const f of all(join(shared, 'opennote-sync')).filter((f) => !f.endsWith('format.json'))) {
      const text = readFileSync(f).toString('latin1');
      expect(text).not.toMatch(/Secret title|top secret|plain attachment|secret\.txt/);
    }

    const wrong = device('B', 'wrong');
    expect((await wrong.sync()).errors.join()).toMatch(/wrong passphrase/);
    const none = device('C');
    expect((await none.sync()).errors.join()).toMatch(/encrypted/);
    const right = device('D', 'correct horse');
    expect(await right.sync()).toMatchObject({ ok: true, pulled: 1 });
    expect(right.store.getNote(n.id).title).toBe('Secret title');
    expect(new TextDecoder().decode(right.store.attachmentData(right.store.listAttachments(n.id)[0]!.id))).toBe('plain attachment bytes');
  });

  it('refuses an unencrypted folder when a passphrase is set', async () => {
    const a = device('A');
    a.store.createNote({ title: 'x' });
    await a.sync();
    const b = device('B', 'pass');
    expect((await b.sync()).errors.join()).toMatch(/not encrypted/);
  });

  it('validates the folder', () => {
    const a = device('A');
    expect(() => a.engine.setConfig({ folder: join(shared, 'nope') })).toThrow(SyncError);
    expect(() => a.engine.setConfig({ folder: join(a.dataDir, 'attachments') })).toThrow(/data folder/);
    const file = join(shared, 'file.txt');
    writeFileSync(file, 'x');
    expect(() => a.engine.setConfig({ folder: file })).toThrow(/does not exist/);
    expect(() => a.engine.setConfig({ intervalMinutes: 0 })).toThrow(/interval/);
    mkdirSync(join(shared, 'ok'));
    expect(() => a.engine.setConfig({ folder: join(shared, 'ok') })).not.toThrow();
  });

  it('ignores files with unsafe names', async () => {
    const a = device('A');
    const b = device('B');
    a.store.createNote({ title: 'real' });
    await a.sync();
    mkdirSync(join(shared, 'opennote-sync', 'notes', '..%2f..%2fetc'), { recursive: true });
    writeFileSync(join(shared, 'opennote-sync', 'notes', 'not-a-note-id'), 'x');
    expect((await b.sync()).ok).toBe(true);
    expect(titles(b)).toEqual(['real']);
  });
});
