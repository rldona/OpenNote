import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bundlePath, checkForUpdate, compareVersions, downloadAsset, isTransientLocation, macSwapScript, parseRelease, pickAsset,
} from '../../desktop/src/updater.js';

const base = 'https://github.com/rldona/OpenNote/releases/download/v0.3.0/';
const asset = (name: string, extra: Record<string, unknown> = {}) => ({ name, browser_download_url: base + name, size: 5, ...extra });
const releaseJson = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.3.0', body: 'Notes', html_url: 'https://github.com/rldona/OpenNote/releases/tag/v0.3.0', draft: false, prerelease: false,
  assets: [
    asset('OpenNote-0.3.0-mac-arm64.dmg'), asset('OpenNote-0.3.0-mac-x64.dmg'),
    asset('OpenNote-0.3.0-win-x64.exe'), asset('OpenNote-0.3.0-win-arm64.exe'), asset('OpenNote-0.3.0-win.exe'),
    asset('OpenNote-0.3.0-linux-amd64.deb'), asset('OpenNote-0.3.0-linux-arm64.deb'),
  ],
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

describe('release parsing', () => {
  it('ignores drafts and prereleases', () => {
    expect(parseRelease(releaseJson())?.version).toBe('0.3.0');
    expect(parseRelease(releaseJson({ draft: true }))).toBeNull();
    expect(parseRelease(releaseJson({ prerelease: true }))).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });

  it('picks the installer for each platform and architecture', () => {
    const r = parseRelease(releaseJson())!;
    expect(pickAsset(r, 'darwin', 'arm64')?.name).toBe('OpenNote-0.3.0-mac-arm64.dmg');
    expect(pickAsset(r, 'darwin', 'x64')?.name).toBe('OpenNote-0.3.0-mac-x64.dmg');
    expect(pickAsset(r, 'win32', 'x64')?.name).toBe('OpenNote-0.3.0-win-x64.exe');
    expect(pickAsset(r, 'win32', 'arm64')?.name).toBe('OpenNote-0.3.0-win-arm64.exe');
    expect(pickAsset(r, 'linux', 'x64')?.name).toBe('OpenNote-0.3.0-linux-amd64.deb');
    expect(pickAsset(r, 'linux', 'arm64')?.name).toBe('OpenNote-0.3.0-linux-arm64.deb');
    expect(pickAsset(r, 'freebsd', 'x64')).toBeNull();
  });

  it('never picks an installer hosted somewhere else', () => {
    const r = parseRelease(releaseJson({
      assets: [{ name: 'OpenNote-0.3.0-mac-arm64.dmg', browser_download_url: 'https://evil.example/OpenNote-0.3.0-mac-arm64.dmg', size: 1 }],
    }))!;
    expect(pickAsset(r, 'darwin', 'arm64')).toBeNull();
  });
});

describe('checking', () => {
  it('reports a newer release, an up-to-date app and failures', async () => {
    const newer = await checkForUpdate('0.2.0', async () => jsonResponse(releaseJson()));
    expect(newer.status).toBe('available');
    expect((await checkForUpdate('0.3.0', async () => jsonResponse(releaseJson()))).status).toBe('uptodate');
    expect((await checkForUpdate('0.4.0', async () => jsonResponse(releaseJson()))).status).toBe('uptodate');
    expect((await checkForUpdate('0.2.0', async () => jsonResponse({}, 404))).status).toBe('error');
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
