import { createHash as nodeHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryBlobStore } from '../src/blobs.js';
import { SqlBlobStore } from '../src/blobs-sql.js';
import { createApp } from '../src/app.js';
import { NoteStore } from '../src/store.js';
import { openTestDb } from './helpers.js';
import { createHash, randomBytes, randomUUID } from '../../web/src/standalone/shims/crypto.js';

describe('browser crypto stand-in', () => {
  it('hashes exactly like Node (the store uses md5 and sha256 for attachments)', () => {
    const samples = [Buffer.alloc(0), Buffer.from('hola'), Buffer.from('café ☕'), Buffer.alloc(100_000, 7)];
    for (const data of samples) {
      for (const alg of ['md5', 'sha256']) {
        expect(createHash(alg).update(data).digest('hex')).toBe(nodeHash(alg).update(data).digest('hex'));
      }
    }
    expect(createHash('sha256').update('a').update('b').digest('hex')).toBe(nodeHash('sha256').update('ab').digest('hex'));
  });

  it('makes ids and random bytes, and refuses what it cannot do', () => {
    expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
    expect(randomBytes(16).length).toBe(16);
    expect(() => createHash('sha512')).toThrow(/not available/);
  });
});

describe.each([
  ['memory', () => new MemoryBlobStore()],
  ['sql', () => new SqlBlobStore(openTestDb())],
])('attachment blob store: %s', (_name, make) => {
  it('stores, reads, replaces and deletes bytes', () => {
    const s = make();
    expect(s.has('a')).toBe(false);
    expect(s.get('a')).toBeNull();
    s.put('a', new Uint8Array([1, 2, 3]));
    expect(s.has('a')).toBe(true);
    expect([...s.get('a')!]).toEqual([1, 2, 3]);
    s.put('a', new Uint8Array([9]));
    expect([...s.get('a')!]).toEqual([9]);
    s.delete('a');
    expect(s.has('a')).toBe(false);
    s.delete('a'); // deleting twice is fine
  });

  it('keeps attachments of a whole NoteStore working', () => {
    const store = new NoteStore(openTestDb(), make());
    const note = store.createNote({ title: 'with file', content: '<p>x</p>' });
    const att = store.addAttachment(note.id, { filename: 'a.bin', mime: 'application/octet-stream', data: new Uint8Array([5, 6, 7, 8]) });
    expect([...store.getAttachment(att.id).data]).toEqual([5, 6, 7, 8]);
    store.deleteAttachment(att.id);
    expect(() => store.getAttachment(att.id)).toThrow();
  });
});

describe('app without a network (standalone option)', () => {
  const app = () => createApp(new NoteStore(openTestDb(), new SqlBlobStore(openTestDb())), undefined, undefined, undefined, { standalone: true });

  it('answers requests that carry no Host header, which a service worker cannot set', async () => {
    const res = await app().fetch(new Request('http://opennote.example/api/notebooks'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('the normal app still refuses foreign hosts', async () => {
    const normal = createApp(new NoteStore(openTestDb(), new MemoryBlobStore()));
    const res = await normal.fetch(new Request('http://evil.example/api/notebooks', { headers: { host: 'evil.example' } }));
    expect(res.status).toBe(403);
  });

  it('exports Markdown (turndown runs on a linkedom node, not a string)', async () => {
    const a = app();
    const created = await (await a.fetch(new Request('http://x/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Hola', content: '<h2>Sub</h2><p>texto <strong>fuerte</strong></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>hecho</p></li></ul>' }) }))).json();
    const md = await (await a.fetch(new Request(`http://x/api/notes/${created.id}/export.md`))).text();
    expect(md).toContain('## Sub');
    expect(md).toContain('**fuerte**');
    expect(md).toContain('- [x] hecho');
  });
});
