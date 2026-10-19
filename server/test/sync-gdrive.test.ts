import { describe, expect, it } from 'vitest';
import { GoogleDriveTransport } from '../src/sync-gdrive.js';
import { createFakeDrive } from './fake-drive.js';

const make = (drive = createFakeDrive(), over: { tokens?: string[] } = {}) => {
  const issued: boolean[] = [];
  const t = new GoogleDriveTransport({
    fetch: drive.fetch,
    sleep: async () => undefined,
    getToken: async (force) => {
      issued.push(force);
      return over.tokens ? over.tokens[Math.min(issued.length - 1, over.tokens.length - 1)]! : 'good';
    },
  });
  return { drive, t, issued };
};

describe('Google Drive transport (against a fake Drive API)', () => {
  it('stores each record as one flat file named with its full path, in the app data folder', async () => {
    const { drive, t } = make();
    await t.write('notes/n1/dev1.json', Buffer.from('one'));
    await t.write('devices/dev1.json', Buffer.from('d'));
    expect(drive.names()).toEqual(['devices/dev1.json', 'notes/n1/dev1.json']);
    expect((await t.list('notes')).map((e) => e.name)).toEqual(['n1']);
    expect((await t.list('notes/n1')).map((e) => e.name)).toEqual(['dev1.json']);
    expect((await t.read('notes/n1/dev1.json'))?.toString()).toBe('one');
  });

  it('replaces content in place (same Drive file), and the version token changes with the content', async () => {
    const { drive, t } = make();
    await t.write('notes/n1/dev1.json', Buffer.from('one'));
    const v1 = (await t.list('notes/n1'))[0]!.version;
    await t.write('notes/n1/dev1.json', Buffer.from('two!'));
    expect(drive.files.size).toBe(1);
    expect((await t.list('notes/n1'))[0]!.version).not.toBe(v1);
    expect((await t.read('notes/n1/dev1.json'))?.toString()).toBe('two!');
  });

  it('lists everything with one paginated query per run, then serves lookups from its index', async () => {
    const drive = createFakeDrive();
    drive.state.pageSize = 3;
    const seed = make(drive).t;
    for (let i = 0; i < 8; i++) await seed.write(`notes/n${i}/d.json`, Buffer.from(String(i)));
    drive.calls.length = 0;
    const { t } = make(drive); // a new run = a new transport
    expect((await t.list('notes')).length).toBe(8);
    expect(drive.calls.filter((c) => c === 'GET /drive/v3/files').length).toBe(3); // 8 files, 3 per page
    await t.exists('notes/n1/d.json');
    await t.list('notes/n2');
    expect(drive.calls.filter((c) => c === 'GET /drive/v3/files').length).toBe(3); // no more listing
  });

  it('removes files, tolerates removing twice, and never touches paths it does not know', async () => {
    const { drive, t } = make();
    await t.write('a/b.json', Buffer.from('x'));
    await t.remove('a/b.json');
    await t.remove('a/b.json');
    expect(drive.files.size).toBe(0);
    expect(await t.exists('a/b.json')).toBe(false);
  });

  it('writeIfAbsent: the first creator wins; a racing creator removes its own copy', async () => {
    const drive = createFakeDrive();
    const a = make(drive).t;
    const b = make(drive).t;
    await a.exists('format.json'); // both load their (empty) index before either writes
    await b.exists('format.json');
    expect(await a.writeIfAbsent('format.json', Buffer.from('A'))).toBe(true);
    expect(await b.writeIfAbsent('format.json', Buffer.from('B'))).toBe(false); // sees A's copy, the older one
    expect(drive.files.size).toBe(1);
    expect((await b.read('format.json'))?.toString()).toBe('A');
  });

  it('uses the resumable protocol above 5 MB, for creating and for updating', async () => {
    const { drive, t } = make();
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 7);
    await t.write('attachments/' + 'a'.repeat(64), big);
    expect(drive.calls.some((c) => c.includes('resumable'))).toBe(true);
    const stored = [...drive.files.values()][0]!;
    expect(stored.data.length).toBe(big.length);
    expect(stored.name).toBe('attachments/' + 'a'.repeat(64));
    const bigger = Buffer.alloc(big.length + 5, 9);
    await t.write('attachments/' + 'a'.repeat(64), bigger);
    expect(drive.files.size).toBe(1);
    expect([...drive.files.values()][0]!.data.length).toBe(bigger.length);
    expect(Buffer.from((await t.read('attachments/' + 'a'.repeat(64)))!).equals(bigger)).toBe(true);
  });

  it('asks for a fresh token once after a 401, and gives up with a clear message', async () => {
    const drive = createFakeDrive();
    const ok = make(drive, { tokens: ['expired', 'good'] });
    await ok.t.write('x.json', Buffer.from('1'));
    expect(ok.issued.slice(0, 2)).toEqual([false, true]); // the 401 triggers one forced refresh
    expect(ok.issued.filter(Boolean).length).toBe(1); // and only one
    const bad = make(drive, { tokens: ['expired'] });
    await expect(bad.t.write('y.json', Buffer.from('1'))).rejects.toThrow(/connect again/);
  });

  it('retries throttling and server errors with backoff, then reports them', async () => {
    const { drive, t } = make();
    drive.state.failNext = [429, 503];
    await t.write('r.json', Buffer.from('1')); // succeeds on the third attempt
    expect(drive.files.size).toBe(1);
    drive.state.failNext = [500, 500, 500, 500];
    await expect(t.write('s.json', Buffer.from('1'))).rejects.toThrow(/error 500/);
  });

  it('refuses unsafe paths', async () => {
    const { t } = make();
    await expect(t.write('../x', Buffer.from('1'))).rejects.toThrow(/unsafe/);
    await expect(t.read("a'b")).rejects.toThrow(/unsafe/);
  });
});
