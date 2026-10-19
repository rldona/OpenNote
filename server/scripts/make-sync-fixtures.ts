/**
 * Writes the sync fixtures of docs/SYNC-FORMAT.md (section 6): two sync locations produced by this implementation, one plain
 * and one encrypted, plus `expected.json` with what any reader must derive from them. Other implementations (Kotlin, for
 * Android and iOS) test against these files, so regenerate them only when the format changes on purpose:
 *
 *   npm run fixtures:sync -w server
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { NoteStore } from '../src/store.js';
import { Codec, SyncEngine, checksum, deriveKey, derivedId, noteHash, type Record_ } from '../src/sync.js';
import { createHash } from 'node:crypto';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'sync-v1');
export const PASSPHRASE = 'correct horse battery staple';
const DEVICE_A = 'device-alpha-0001';
const DEVICE_B = 'device-bravo-0002';

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

function device(id: string, name: string, folder: string, passphrase: string | null) {
  const dataDir = mkdtempSync(join(tmpdir(), `opennote-fixture-${name}-`));
  const store = new NoteStore(openDb(':memory:'), join(dataDir, 'attachments'));
  store.setMeta('device.id', id);
  const engine = new SyncEngine(store, { dataDir, deviceName: name });
  engine.setConfig({ folder, enabled: true, passphrase });
  return { store, run: async () => {
    const s = await engine.run();
    if (!s.ok) throw new Error(`${name}: ${s.errors.join('; ')}`);
    return s;
  } };
}

/** The same story on both locations: everything a reader has to handle, ending with every device converged. */
async function writeLocation(folder: string, passphrase: string | null) {
  mkdirSync(folder, { recursive: true });
  const a = device(DEVICE_A, 'Laptop', folder, passphrase);
  const b = device(DEVICE_B, 'Teléfono', folder, passphrase);

  const trips = a.store.createNotebook('Viajes', 'Vida');
  const work = a.store.createNotebook('Trabajo');
  // Strings that a JSON writer can get wrong: quotes, backslash, slash, controls, U+2028, astral emoji, accents.
  const rome = a.store.createNote({
    notebookId: trips.id,
    title: 'Roma 🇮🇹 — "citas" \\ a/b\ttab línea',
    content: '<p>Coliseo y <strong>Foro</strong> &amp; café</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false" data-due="2026-11-02"><p>Reservar</p></li></ul>',
    tags: ['viajes/italia', 'Fotos', 'ñandú'],
    pinned: true,
    reminderAt: 1793000000000,
    sourceUrl: 'https://example.org/roma?x=1&y=2',
  });
  const att = a.store.addAttachment(rome.id, { filename: 'mapa (1).png', mime: 'image/png', data: new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]) });
  a.store.updateNote(rome.id, { content: `${a.store.getNote(rome.id).content}<img src="/api/attachments/${att.id}">` });
  const trashed = a.store.createNote({ notebookId: work.id, title: 'Borrador viejo', content: '<p>a la papelera</p>' });
  a.store.trashNote(trashed.id);
  const tpl = a.store.createNote({ notebookId: work.id, title: 'Acta del comité', content: '<h2>Asistentes</h2><p></p>' });
  a.store.saveAsTemplate(tpl.id);
  const gone = a.store.createNote({ notebookId: work.id, title: 'Se borrará', content: '<p>x</p>' });
  const shared = a.store.createNote({ notebookId: work.id, title: 'Plan', content: '<p>v1</p>' });
  await a.run();
  await b.run();

  // A deletes one note for good; both edit the same note without seeing each other: a conflict copy appears.
  a.store.deleteNotePermanently(gone.id);
  a.store.updateNote(shared.id, { content: '<p>v2 desde el portátil</p>', updatedAt: 1792000000000 });
  b.store.updateNote(shared.id, { content: '<p>v2 desde el teléfono</p>', updatedAt: 1792000005000 });
  await b.run();
  await a.run();
  await b.run();
  await a.run();

  const ids = (s: NoteStore) => s.syncNoteIds().filter((id) => s.exportForSync(id)).sort();
  const notes = ids(a.store).map((id) => a.store.exportForSync(id)!);
  const other = ids(b.store).map((id) => b.store.exportForSync(id)!);
  if (JSON.stringify(notes) !== JSON.stringify(other)) throw new Error('devices did not converge');
  return { notes, deletedIds: [gone.id], conflictOf: shared.id };
}

function describeRecords(folder: string, codec: Codec) {
  const root = join(folder, 'opennote-sync');
  const out: { path: string; deviceId: string; deleted: boolean; chk: string; noteHash: string | null }[] = [];
  for (const noteId of readdirSync(join(root, 'notes')).sort()) {
    for (const file of readdirSync(join(root, 'notes', noteId)).sort()) {
      const rec = JSON.parse(codec.decode(readFileSync(join(root, 'notes', noteId, file))).toString('utf8')) as Record_;
      if (checksum(rec) !== rec.chk) throw new Error(`bad checksum in ${noteId}/${file}`);
      out.push({ path: `notes/${noteId}/${file}`, deviceId: rec.deviceId, deleted: rec.deleted === true, chk: rec.chk!, noteHash: rec.note ? noteHash(rec.note) : null });
    }
  }
  return out;
}

/** Values whose JSON text implementations must reproduce exactly (docs/SYNC-FORMAT.md 3.4). */
const STRINGIFY_CASES: unknown[] = [
  'plain', '', 'quote " and backslash \\ and slash /', 'controls \b\f\n\r\t \u0000 \u0001 \u001f \u007f',
  'line sep   para sep  ', 'accents ñ á ü ß', 'emoji 🇮🇹 👩‍💻 😀', 'lone \ud800 surrogate \udfff end',
  '<script>alert("x")</script>', 0, 1, -5, 1792000000000, 9007199254740991, true, false, null,
  [], {}, [1, 'a', null, [true]], { b: 1, a: { d: [], c: 'x' } },
];

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  const work = mkdtempSync(join(tmpdir(), 'opennote-fixtures-'));
  const plainDir = join(work, 'plain');
  const encDir = join(work, 'encrypted');
  const plain = await writeLocation(plainDir, null);
  const enc = await writeLocation(encDir, PASSPHRASE);

  const format = JSON.parse(readFileSync(join(encDir, 'opennote-sync', 'format.json'), 'utf8')) as { salt: string };
  const key = deriveKey(PASSPHRASE, Buffer.from(format.salt, 'base64'));
  const encCodec = new Codec(key);

  cpSync(plainDir, join(OUT, 'plain'), { recursive: true });
  cpSync(encDir, join(OUT, 'encrypted'), { recursive: true });

  const fixedSalt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
  const expected = {
    about: 'docs/SYNC-FORMAT.md, section 6. Generated by server/scripts/make-sync-fixtures.ts; do not edit by hand.',
    passphrase: PASSPHRASE,
    devices: [DEVICE_A, DEVICE_B],
    locations: {
      plain: { encrypted: false, ...plain, records: describeRecords(plainDir, new Codec(null)) },
      encrypted: { encrypted: true, keyHex: key.toString('hex'), ...enc, records: describeRecords(encDir, encCodec) },
    },
    stringify: STRINGIFY_CASES.map((value) => {
      const json = JSON.stringify(value);
      return { json, sha256: sha(json) };
    }),
    scrypt: [
      { passphrase: PASSPHRASE, saltHex: fixedSalt.toString('hex') },
      { passphrase: 'contraseña ñ 🔐', saltHex: fixedSalt.toString('hex') },
      { passphrase: '', saltHex: 'ff'.repeat(16) },
    ].map((c) => ({ ...c, keyHex: deriveKey(c.passphrase, Buffer.from(c.saltHex, 'hex')).toString('hex') })),
    derivedId: ['conflict:x:y:z', '', 'ñ 🔐'].map((text) => ({ text, id: derivedId(text) })),
    blobName: [sha('hello'), sha('')].map((s) => ({ sha256: s, plain: new Codec(null).blobName(s), encrypted: encCodec.blobName(s) })),
  };
  writeFileSync(join(OUT, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);
  rmSync(work, { recursive: true, force: true });
  console.log(`Fixtures written to ${OUT}`);
}

await main();
