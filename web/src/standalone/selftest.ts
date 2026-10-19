/**
 * Diagnostic: two simulated devices sync an encrypted note with an attachment through an in-memory transport, entirely
 * inside this browser worker. Uses throw-away in-memory databases, never the user's data. Tells whether this browser can
 * run the sync engine (AES-GCM, scrypt, SQLite) and how long it takes.
 */
import { SqlBlobStore } from '../../../server/src/blobs-sql';
import { initSchema } from '../../../server/src/schema';
import { wasmDatabase, type WasmDb } from '../../../server/src/sql-wasm';
import { NoteStore } from '../../../server/src/store';
import { SyncEngine } from '../../../server/src/sync';
import { MemoryTransport } from '../../../server/src/sync-transport';

export interface SelfTestResult {
  ok: boolean;
  ms: number;
  steps: string[];
  error?: string;
}

export async function selfTest(sqlite3: { oo1: { DB: new (file: string) => unknown } }): Promise<SelfTestResult> {
  const t0 = performance.now();
  const steps: string[] = [];
  const expect = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`failed: ${what}`);
    steps.push(what);
  };
  try {
    const remote = new MemoryTransport();
    const device = (name: string) => {
      const db = wasmDatabase(new sqlite3.oo1.DB(':memory:') as WasmDb);
      initSchema(db);
      const store = new NoteStore(db, new SqlBlobStore(db));
      const engine = new SyncEngine(store, { dataDir: '', deviceName: name, transport: () => remote });
      engine.setConfig({ passphrase: 'self-test passphrase' });
      return { store, run: () => engine.run() };
    };
    const a = device('A');
    const b = device('B');

    const note = a.store.createNote({ title: 'Café ☕', content: '<p>secreto</p>', tags: ['x/y'] });
    const att = a.store.addAttachment(note.id, { filename: 'f.bin', mime: 'application/octet-stream', data: new Uint8Array([1, 2, 3, 4]) });
    a.store.updateNote(note.id, { content: `<p>secreto</p><a href="/api/attachments/${att.id}">f</a>` });

    const ra = await a.run();
    expect(ra.ok && ra.pushed === 1, 'device A pushed its note (encrypted)');
    const rb = await b.run();
    expect(rb.ok && rb.pulled === 1, 'device B pulled it and decrypted it');
    expect(b.store.listNotes({}).some((n) => n.title === 'Café ☕'), 'title survived the round trip');
    expect([...b.store.attachmentData(att.id)].join() === '1,2,3,4', 'attachment bytes survived');

    b.store.updateNote(note.id, { title: 'Editada en B' });
    await b.run();
    await a.run();
    expect(a.store.getNote(note.id).title === 'Editada en B', 'an edit made on B reached A');

    for (const file of await remote.list(`notes/${note.id}`)) {
      const raw = (await remote.read(`notes/${note.id}/${file.name}`))!;
      expect(!Buffer.from(raw).toString('latin1').includes('secreto'), 'stored files do not contain the plain text');
    }
    return { ok: true, ms: Math.round(performance.now() - t0), steps };
  } catch (err) {
    return { ok: false, ms: Math.round(performance.now() - t0), steps, error: err instanceof Error ? err.message : String(err) };
  }
}
