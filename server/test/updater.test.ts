import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bundlePath, checkForUpdate, compareVersions, downloadAsset, isTransientLocation, macSwapScript, parseManifest, pickAsset,
} from '../../desktop/src/updater.js';

const base = 'https://github.com/rldona/OpenNote/releases/download/v0.3.0/';
const sha = (c: string) => c.repeat(64).slice(0, 64);
const manifest = (over: Record<string, unknown> = {}) => ({
  version: '0.3.0',
  notes: 'Notes',
  assets: [
    'OpenNote-0.3.0-mac-arm64.dmg', 'OpenNote-0.3.0-mac-x64.dmg', 'OpenNote-0.3.0-win-x64.exe', 'OpenNote-0.3.0-win-arm64.exe',
    'OpenNote-0.3.0-win.exe', 'OpenNote-0.3.0-linux-amd64.deb', 'OpenNote-0.3.0-linux-arm64.deb',
  ].map((name) => ({ name, size: 5, sha256: sha('a') })),
  ...over,
});
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('versions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.2.1')).toBeLessThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });
});

describe('update manifest', () => {
  it('reads version, notes, sizes and checksums, and builds the download addresses itself', () => {
    const r = parseManifest(manifest())!;
    expect(r.version).toBe('0.3.0');
    expect(r.pageUrl).toBe('https://github.com/rldona/OpenNote/releases/tag/v0.3.0');
    const dmg = r.assets.find((a) => a.name.endsWith('mac-arm64.dmg'))!;
    expect(dmg).toMatchObject({ url: `${base}OpenNote-0.3.0-mac-arm64.dmg`, size: 5, digest: `sha256:${sha('a')}` });
  });

  it('ignores addresses written in the file, odd file names and bad checksums', () => {
    const r = parseManifest(manifest({
      assets: [
        { name: 'OpenNote-0.3.0-mac-arm64.dmg', size: 1, sha256: 'not-a-hash', url: 'https://evil.example/x.dmg' },
        { name: '../evil.dmg', size: 1, sha256: sha('b') },
        { name: 'a b.dmg', size: 1, sha256: sha('b') },
      ],
    }))!;
    expect(r.assets.map((a) => a.name)).toEqual(['OpenNote-0.3.0-mac-arm64.dmg']);
    expect(r.assets[0]!.url).toBe(`${base}OpenNote-0.3.0-mac-arm64.dmg`);
    expect(r.assets[0]!.digest).toBeNull();
  });

  it('rejects anything that is not a plain x.y.z version', () => {
    for (const bad of [null, 'text', {}, manifest({ version: 'latest' }), manifest({ version: '1.2' }), manifest({ version: '1.2.3-beta' })]) {
      expect(parseManifest(bad)).toBeNull();
    }
  });

  it('picks the installer for each platform and architecture', () => {
    const r = parseManifest(manifest())!;
    expect(pickAsset(r, 'darwin', 'arm64')?.name).toBe('OpenNote-0.3.0-mac-arm64.dmg');
    expect(pickAsset(r, 'darwin', 'x64')?.name).toBe('OpenNote-0.3.0-mac-x64.dmg');
    expect(pickAsset(r, 'win32', 'x64')?.name).toBe('OpenNote-0.3.0-win-x64.exe');
    expect(pickAsset(r, 'win32', 'arm64')?.name).toBe('OpenNote-0.3.0-win-arm64.exe');
    expect(pickAsset(r, 'linux', 'x64')?.name).toBe('OpenNote-0.3.0-linux-amd64.deb');
    expect(pickAsset(r, 'linux', 'arm64')?.name).toBe('OpenNote-0.3.0-linux-arm64.deb');
    expect(pickAsset(r, 'freebsd', 'x64')).toBeNull();
  });

  it('is generated from the installers of a release, with their real size and SHA-256', async () => {
    // @ts-ignore: a plain .mjs script run by CI, with no type declarations
    const { buildManifest } = (await import('../../desktop/scripts/make-update-manifest.mjs')) as {
      buildManifest: (v: string, dir: string, notes: string) => { version: string; notes: string; assets: { name: string; size: number; sha256: string }[] };
    };
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
    writeFileSync(join(dir, 'OpenNote-9.9.9-mac-arm64.dmg'), 'hello');
    writeFileSync(join(dir, 'OpenNote-9.9.9-linux-amd64.deb'), 'world!');
    writeFileSync(join(dir, 'notes.txt'), 'not an installer');
    const m = buildManifest('9.9.9', dir, '  ## Added\n- things  \n');
    expect(m.version).toBe('9.9.9');
    expect(m.notes).toBe('## Added\n- things');
    expect(m.assets.map((a) => a.name)).toEqual(['OpenNote-9.9.9-linux-amd64.deb', 'OpenNote-9.9.9-mac-arm64.dmg']);
    expect(m.assets[1]).toMatchObject({ size: 5, sha256: createHash('sha256').update('hello').digest('hex') });
    // and the app can read what the script wrote
    expect(parseManifest(m)?.assets.length).toBe(2);
  });
});

describe('checking', () => {
  it('reads the manifest from a plain file download, not from the rate-limited GitHub API', async () => {
    const urls: string[] = [];
    const get = async (url: string | URL | Request) => {
      urls.push(String(url));
      return jsonResponse(manifest());
    };
    expect((await checkForUpdate('0.2.0', get as typeof fetch)).status).toBe('available');
    expect(urls[0]).toBe('https://github.com/rldona/OpenNote/releases/latest/download/latest.json');
    expect(urls.some((u) => u.includes('api.github.com'))).toBe(false);
  });

  it('reports a newer release, an up-to-date app and failures', async () => {
    const ok = async () => jsonResponse(manifest());
    const newer = await checkForUpdate('0.2.0', ok);
    expect(newer.status).toBe('available');
    expect((await checkForUpdate('0.3.0', ok)).status).toBe('uptodate');
    expect((await checkForUpdate('0.4.0', ok)).status).toBe('uptodate');
    expect(await checkForUpdate('0.2.0', async () => jsonResponse({}, 404))).toEqual({ status: 'error', message: 'GitHub answered 404' });
    expect((await checkForUpdate('0.2.0', async () => new Response('<html>', { status: 200 }))).status).toBe('error');
    expect((await checkForUpdate('0.2.0', async () => { throw new Error('offline'); })).status).toBe('error');
  });
});

describe('downloading', () => {
  const bytes = Buffer.from('hello');
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const serve = async () => new Response(bytes);

  it('saves the file after checking size and checksum', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'upd-'));
    const seen: number[] = [];
    const file = await downloadAsset({ name: 'a.dmg', url: `${base}a.dmg`, size: 5, digest }, dir, (f) => seen.push(f), serve);
    expect(readFileSync(file).toString()).toBe('hello');
    expect(seen.at(-1)).toBe(1);
  });

  it('rejects a corrupted download and leaves nothing behind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'upd-'));
    const bad = `sha256:${'0'.repeat(64)}`;
    await expect(downloadAsset({ name: 'b.dmg', url: `${base}b.dmg`, size: 5, digest: bad }, dir, () => undefined, serve)).rejects.toThrow(/checksum/);
    expect(existsSync(join(dir, 'b.dmg'))).toBe(false);
    expect(existsSync(join(dir, 'b.dmg.part'))).toBe(false);
    await expect(downloadAsset({ name: 'c.dmg', url: `${base}c.dmg`, size: 9, digest: null }, dir, () => undefined, serve)).rejects.toThrow(/size/);
  });

  it('refuses other hosts and odd file names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'upd-'));
    await expect(downloadAsset({ name: 'a.dmg', url: 'https://evil.example/a.dmg', size: 5, digest: null }, dir, () => undefined, serve)).rejects.toThrow(/unexpected/i);
    await expect(downloadAsset({ name: '../a.dmg', url: `${base}a.dmg`, size: 5, digest: null }, dir, () => undefined, serve)).rejects.toThrow(/file name/i);
  });
});

describe('macOS bundle swap', () => {
  it('finds the bundle and recognises read-only locations', () => {
    expect(bundlePath('/Applications/OpenNote.app/Contents/MacOS/OpenNote')).toBe('/Applications/OpenNote.app');
    expect(bundlePath('/usr/bin/node')).toBeNull();
    expect(isTransientLocation('/Volumes/OpenNote 0.2.0/OpenNote.app')).toBe(true);
    expect(isTransientLocation('/private/var/folders/x/AppTranslocation/ABC/d/OpenNote.app')).toBe(true);
    expect(isTransientLocation('/Applications/OpenNote.app')).toBe(false);
  });

  const swap = (target: string, staged: string, dir: string) => {
    const script = join(dir, 'swap.sh');
    writeFileSync(script, macSwapScript);
    // pid 999999999 does not exist, so the script does not wait.
    return execFileSync('/bin/sh', [script, '999999999', target, staged], { env: { ...process.env, OPENNOTE_NO_RELAUNCH: '1' } });
  };
  const fakeApp = (path: string, version: string) => {
    mkdirSync(join(path, 'Contents'), { recursive: true });
    writeFileSync(join(path, 'Contents', 'version'), version);
  };

  it.skipIf(process.platform !== 'darwin')('replaces the old bundle with the staged one and cleans up', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swap-'));
    const target = join(dir, 'OpenNote.app');
    const staged = join(dir, 'stage', 'OpenNote.app');
    fakeApp(target, 'old');
    fakeApp(staged, 'new');
    swap(target, staged, dir);
    expect(readFileSync(join(target, 'Contents', 'version')).toString()).toBe('new');
    expect(existsSync(`${target}.old-update`)).toBe(false);
    expect(existsSync(staged)).toBe(false);
  });

  it.skipIf(process.platform !== 'darwin')('keeps the old bundle when the staged copy is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swap-'));
    const target = join(dir, 'OpenNote.app');
    fakeApp(target, 'old');
    expect(() => swap(target, join(dir, 'missing.app'), dir)).toThrow();
    expect(readFileSync(join(target, 'Contents', 'version')).toString()).toBe('old');
  });
});
