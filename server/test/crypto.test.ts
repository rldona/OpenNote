import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openTestDb } from './helpers.js';
import { NoteStore } from '../src/store.js';
import { WrongPassphraseError, isEncryptedHtml, lockNote, parseEnvelope, unlockNote } from '../../web/src/crypto.js';

const ITER = 1000; // production uses 600k; lowered so the suite stays fast
const SECRET = '<p>my <b>secret</b> plan: café ☕ 日本語</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>hide</p></li></ul>';

describe('encrypted notes (browser crypto)', () => {
  it('round-trips unicode HTML and never contains the plaintext', async () => {
    const { envelope } = await lockNote(SECRET, 'correct horse', ITER);
    expect(isEncryptedHtml(envelope)).toBe(true);
    expect(envelope).not.toMatch(/secret|plan|café|hide/);
    const { html } = await unlockNote(envelope, 'correct horse');
    expect(html).toBe(SECRET);
  });

  it('rejects a wrong passphrase and any tampering', async () => {
    const { envelope } = await lockNote(SECRET, 'right', ITER);
    await expect(unlockNote(envelope, 'wrong')).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(unlockNote(envelope, '')).rejects.toBeInstanceOf(WrongPassphraseError);
    const e = parseEnvelope(envelope)!;
    const flipped = envelope.replace(/data-ct="(.)/, (_, c) => `data-ct="${c === 'A' ? 'B' : 'A'}`);
    await expect(unlockNote(flipped, 'right')).rejects.toBeInstanceOf(WrongPassphraseError);
    // Lowering the iteration count (a downgrade attempt) derives a different key, so decryption fails.
    await expect(unlockNote(envelope.replace(`data-iter="${e.iterations}"`, 'data-iter="1"'), 'right')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('re-encrypts edits with the same key and a fresh IV', async () => {
    const { envelope, cipher } = await lockNote('<p>v1</p>', 'pw', ITER);
    const second = await cipher.encrypt('<p>v2</p>');
    const a = parseEnvelope(envelope)!;
    const b = parseEnvelope(second)!;
    expect(Buffer.from(a.salt).equals(Buffer.from(b.salt))).toBe(true);
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect((await unlockNote(second, 'pw')).html).toBe('<p>v2</p>');
  });

  it('treats equivalent unicode passphrases alike (NFKC)', async () => {
    const { envelope } = await lockNote('<p>x</p>', 'café', ITER);
    expect((await unlockNote(envelope, 'café')).html).toBe('<p>x</p>');
  });

  it('refuses things that are not envelopes', async () => {
    expect(parseEnvelope('<p>plain</p>')).toBeNull();
    expect(parseEnvelope('<div data-opennote-encrypted="1" data-iter="x"></div>')).toBeNull();
    await expect(unlockNote('<p>plain</p>', 'pw')).rejects.toThrow(/not encrypted/);
  });
});

describe('server with encrypted notes', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'opennote-enc-'));
    const store = new NoteStore(openTestDb(), join(dir, 'attachments'));
    return { store, app: createApp(store) };
  };
  const H = { host: 'localhost:3737', 'content-type': 'application/json' };

  it('stores only ciphertext: search, snippets and exports reveal nothing', async () => {
    const { store, app } = setup();
    const { envelope } = await lockNote(SECRET, 'pw', ITER);
    const res = await app.request('/api/notes', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Diary', content: envelope }) });
    const note = (await res.json()) as { id: string; content: string };
    expect(isEncryptedHtml(note.content)).toBe(true); // survives sanitizing intact
    expect((await unlockNote(note.content, 'pw')).html).toBe(SECRET);

    expect(store.listNotes({ q: 'secret' })).toHaveLength(0);
    expect(store.listNotes({ q: 'encrypted' })).toHaveLength(1);
    expect(store.listNotes({})[0]!.snippet).toBe('🔒 Encrypted note');
    expect(store.listTasks({})).toHaveLength(0);

    const md = await (await app.request(`/api/notes/${note.id}/export.md`, { headers: H })).text();
    expect(md).not.toMatch(/secret|café/);
    const enex = await (await app.request(`/api/export/enex?note=${note.id}`, { headers: H })).text();
    expect(enex).not.toMatch(/secret|café/);
  });
});
