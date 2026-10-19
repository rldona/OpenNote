/**
 * The sync fixtures (docs/SYNC-FORMAT.md, section 6) are the contract with the other implementations. These tests keep them
 * honest: this implementation still derives exactly what expected.json says, and a fresh device that syncs from a copy of
 * each location ends up with the expected notes. A location written by the Kotlin implementation is checked the same way
 * when its tests have produced one (mobile/shared/build/sync-fixtures-kotlin).
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openTestDb } from './helpers.js';
import { NoteStore, type SyncNote } from '../src/store.js';
import { Codec, SyncEngine, checksum, deriveKey, derivedId, noteHash, type Record_ } from '../src/sync.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, 'fixtures', 'sync-v1');
const KOTLIN = join(here, '..', '..', 'mobile', 'shared', 'build', 'sync-fixtures-kotlin');

interface Location { encrypted: boolean; keyHex?: string; notes: SyncNote[]; records: { path: string; chk: string; noteHash: string | null }[] }
const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as {
  passphrase: string;
  locations: Record<'plain' | 'encrypted', Location>;
  stringify: { json: string; sha256: string }[];
  scrypt: { passphrase: string; saltHex: string; keyHex: string }[];
  derivedId: { text: string; id: string }[];
  blobName: { sha256: string; plain: string; encrypted: string }[];
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A new device syncs from a copy of the location and returns what it holds. */
async function readAsNewDevice(source: string, passphrase: string | null): Promise<SyncNote[]> {
  const folder = mkdtempSync(join(tmpdir(), 'opennote-fixture-read-'));
  cpSync(source, folder, { recursive: true });
  const dataDir = mkdtempSync(join(tmpdir(), 'opennote-fixture-dev-'));
  const store = new NoteStore(openTestDb(), join(dataDir, 'attachments'));
  store.setMeta('device.id', 'device-charlie-0003');
  const engine = new SyncEngine(store, { dataDir, deviceName: 'Tablet' });
  engine.setConfig({ folder, enabled: true, passphrase });
  const status = await engine.run();
  expect(status.errors).toEqual([]);
  return store.syncNoteIds().map((id) => store.exportForSync(id)).filter((n): n is SyncNote => !!n).sort((a, b) => a.id.localeCompare(b.id));
}

const comparable = (notes: SyncNote[]) => notes.map((n) => ({ ...n, attachments: n.attachments.map(({ createdAt: _c, ...a }) => a) }));

describe('sync fixtures (docs/SYNC-FORMAT.md)', () => {
  it('JSON text matches JSON.stringify', () => {
    for (const c of expected.stringify) {
      expect(JSON.stringify(JSON.parse(c.json))).toBe(c.json);
      expect(sha(c.json)).toBe(c.sha256);
    }
  });

  it('scrypt keys, derived ids and attachment names', () => {
    for (const c of expected.scrypt) expect(deriveKey(c.passphrase, Buffer.from(c.saltHex, 'hex')).toString('hex')).toBe(c.keyHex);
    for (const c of expected.derivedId) expect(derivedId(c.text)).toBe(c.id);
    const enc = new Codec(Buffer.from(expected.locations.encrypted.keyHex!, 'hex'));
    for (const c of expected.blobName) {
      expect(new Codec(null).blobName(c.sha256)).toBe(c.plain);
      expect(enc.blobName(c.sha256)).toBe(c.encrypted);
    }
  });

  for (const name of ['plain', 'encrypted'] as const) {
    const loc = expected.locations[name];
    const root = join(FIXTURES, name, 'opennote-sync');
    const codec = new Codec(loc.keyHex ? Buffer.from(loc.keyHex, 'hex') : null);

    it(`${name}: every record has the expected checksum and content hash`, () => {
      for (const r of loc.records) {
        const rec = JSON.parse(codec.decode(readFileSync(join(root, r.path))).toString('utf8')) as Record_;
        expect(checksum(rec)).toBe(r.chk);
        expect(rec.chk).toBe(r.chk);
        expect(rec.note ? noteHash(rec.note) : null).toBe(r.noteHash);
      }
      const onDisk = readdirSync(join(root, 'notes')).flatMap((id) => readdirSync(join(root, 'notes', id)).map((f) => `notes/${id}/${f}`));
      expect(onDisk.sort()).toEqual(loc.records.map((r) => r.path).sort());
    });

    it(`${name}: a new device ends up with the expected notes`, async () => {
      const got = await readAsNewDevice(join(FIXTURES, name), loc.encrypted ? expected.passphrase : null);
      expect(comparable(got)).toEqual(comparable([...loc.notes].sort((a, b) => a.id.localeCompare(b.id))));
    });
  }

  it.skipIf(!existsSync(KOTLIN))('a location written by the Kotlin implementation reads back the same notes', async () => {
    const meta = JSON.parse(readFileSync(join(KOTLIN, 'expected.json'), 'utf8')) as { passphrase: string | null; notes: SyncNote[] };
    const got = await readAsNewDevice(join(KOTLIN, 'location'), meta.passphrase);
    expect(comparable(got)).toEqual(comparable([...meta.notes].sort((a, b) => a.id.localeCompare(b.id))));
  });
});
