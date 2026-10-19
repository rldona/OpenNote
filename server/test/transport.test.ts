import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { NoteStore } from '../src/store.js';
import { SyncEngine } from '../src/sync.js';
import { FolderTransport, MemoryTransport, checkPath, type SyncTransport } from '../src/sync-transport.js';

const impls: [string, () => SyncTransport][] = [
  ['memory', () => new MemoryTransport()],
  ['folder', () => new FolderTransport(mkdtempSync(join(tmpdir(), 'opennote-tr-')))],
];

describe.each(impls)('transport contract: %s', (_name, make) => {
  it('writes, reads, lists, replaces and removes', async () => {
    const t = make();
    expect(await t.read('notes/a/b.json')).toBeNull();
    expect(await t.list('notes')).toEqual([]);
    await t.write('notes/n1/dev1.json', Buffer.from('one'));
    await t.write('notes/n1/dev2.json', Buffer.from('two'));
    await t.write('notes/n2/dev1.json', Buffer.from('three'));
    expect((await t.list('notes')).map((e) => e.name).sort()).toEqual(['n1', 'n2']);
    expect((await t.list('notes/n1')).map((e) => e.name).sort()).toEqual(['dev1.json', 'dev2.json']);
    expect((await t.read('notes/n1/dev1.json'))?.toString()).toBe('one');

    const before = (await t.list('notes/n1')).find((e) => e.name === 'dev1.json')!.version;
    await new Promise((r) => setTimeout(r, 5));
    await t.write('notes/n1/dev1.json', Buffer.from('uno!'));
    const after = (await t.list('notes/n1')).find((e) => e.name === 'dev1.json')!.version;
    expect(after).not.toBe(before); // the engine relies on this to notice changes
    expect((await t.read('notes/n1/dev1.json'))?.toString()).toBe('uno!');

    expect(await t.exists('notes/n1/dev1.json')).toBe(true);
    await t.remove('notes/n1/dev1.json');
    await t.remove('notes/n1/dev1.json'); // removing twice is fine
    expect(await t.exists('notes/n1/dev1.json')).toBe(false);
  });

  it('writeIfAbsent lets only the first writer win', async () => {
    const t = make();
    expect(await t.writeIfAbsent('format.json', Buffer.from('first'))).toBe(true);
    expect(await t.writeIfAbsent('format.json', Buffer.from('second'))).toBe(false);
    expect((await t.read('format.json'))?.toString()).toBe('first');
  });

  it('refuses paths that could escape the root', async () => {
    const t = make();
    for (const bad of ['../x', 'notes/../../x', '/etc/passwd', 'notes//x', 'a\\b', '.hidden/x']) {
      await expect(t.write(bad, Buffer.from('x'))).rejects.toThrow(/unsafe/);
      await expect(t.read(bad)).rejects.toThrow(/unsafe/);
    }
    expect(checkPath('')).toEqual([]);
  });
});

function device(name: string, remote: SyncTransport, passphrase?: string) {
  const dataDir = mkdtempSync(join(tmpdir(), `opennote-dev-${name}-`));
  const store = new NoteStore(openDb(':memory:'), join(dataDir, 'attachments'));
  const engine = new SyncEngine(store, { dataDir, deviceName: name, transport: () => remote });
  if (passphrase) engine.setConfig({ passphrase });
  return { store, run: () => engine.run() };
}

describe('sync engine over a transport that is not a folder', () => {
  it('converges three devices, including attachments, edits, deletes and conflicts', async () => {
    const remote = new MemoryTransport();
    const a = device('A', remote);
    const b = device('B', remote);
    const c = device('C', remote);

    const n = a.store.createNote({ title: 'Plan', content: '<p>v1</p>', tags: ['x/y'] });
    const att = a.store.addAttachment(n.id, { filename: 'f.bin', mime: 'application/octet-stream', data: new Uint8Array([9, 8, 7]) });
    a.store.updateNote(n.id, { content: `<p>v1</p><a href="/api/attachments/${att.id}">f</a>` });
    expect((await a.run()).ok).toBe(true);
    for (const d of [b, c]) {
      expect((await d.run()).ok).toBe(true);
      expect(d.store.listNotes({}).map((x) => x.title)).toEqual(['Plan']);
    }
    expect(Buffer.from(b.store.attachmentData(att.id)).equals(Buffer.from([9, 8, 7]))).toBe(true);

    // B and C edit the same note without seeing each other: one wins, the other survives as a conflict copy.
    b.store.updateNote(n.id, { title: 'Plan (B)' });
    await new Promise((r) => setTimeout(r, 5));
    c.store.updateNote(n.id, { title: 'Plan (C)' });
    await b.run();
    await c.run();
    await a.run();
    await b.run();
    await c.run();
    const titlesOf = (d: typeof a) => d.store.listNotes({}).map((x) => x.title).sort();
    expect(titlesOf(a)).toEqual(titlesOf(b));
    expect(titlesOf(b)).toEqual(titlesOf(c));
    expect(titlesOf(a).length).toBe(2);
    expect(titlesOf(a).some((t) => /conflict/.test(t))).toBe(true);

    // Delete everywhere.
    for (const id of a.store.listNotes({}).map((x) => x.id)) a.store.deleteNotePermanently(id);
    await a.run();
    await b.run();
    await c.run();
    expect(b.store.listNotes({})).toEqual([]);
    expect(c.store.listNotes({})).toEqual([]);
  });

  it('encrypts everything it stores, and a wrong passphrase is rejected', async () => {
    const remote = new MemoryTransport();
    const a = device('A', remote, 'correct horse');
    a.store.createNote({ title: 'Secret title', content: '<p>Secret body</p>' });
    expect((await a.run()).ok).toBe(true);

    const files = [
      ...(await remote.list('notes')).map((e) => e.name),
    ];
    for (const id of files) {
      for (const f of await remote.list(`notes/${id}`)) {
        const raw = (await remote.read(`notes/${id}/${f.name}`))!.toString('latin1');
        expect(raw).not.toContain('Secret');
      }
    }
    const intruder = device('X', remote, 'wrong passphrase');
    const r = await intruder.run();
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/passphrase/);
    const friend = device('B', remote, 'correct horse');
    expect((await friend.run()).ok).toBe(true);
    expect(friend.store.listNotes({}).map((x) => x.title)).toEqual(['Secret title']);
  });
});
