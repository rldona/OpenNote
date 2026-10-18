/**
 * Update logic for the desktop app. No Electron imports, so it can be tested on its own.
 *
 * It reads the latest GitHub Release, compares versions, downloads the installer for this platform and checks its SHA-256
 * against the digest GitHub publishes for the asset. Installing is platform specific (see `main.ts`):
 * macOS swaps the app bundle in place (`macSwapScript`), Windows runs the NSIS installer silently, Linux opens the .deb.
 */
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const REPO = 'rldona/OpenNote';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
/** Installers only ever come from this release path of our repository. */
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  /** "sha256:<hex>" as reported by the GitHub API, when present. */
  digest: string | null;
}

export interface Release {
  version: string;
  notes: string;
  pageUrl: string;
  assets: ReleaseAsset[];
}

export type CheckResult =
  | { status: 'uptodate'; current: string }
  | { status: 'available'; current: string; release: Release }
  | { status: 'error'; message: string };

/** Compares "1.2.3" style versions (a leading "v" and any "-prerelease" suffix are ignored). Returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/i, '').split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function parseRelease(json: unknown): Release | null {
  if (typeof json !== 'object' || json === null) return null;
  const r = json as Record<string, unknown>;
  if (typeof r.tag_name !== 'string' || r.draft === true || r.prerelease === true) return null;
  const assets = Array.isArray(r.assets) ? r.assets : [];
  return {
    version: r.tag_name.replace(/^v/i, ''),
    notes: typeof r.body === 'string' ? r.body : '',
    pageUrl: typeof r.html_url === 'string' ? r.html_url : `https://github.com/${REPO}/releases`,
    assets: assets.flatMap((a): ReleaseAsset[] => {
      const x = a as Record<string, unknown>;
      if (typeof x.name !== 'string' || typeof x.browser_download_url !== 'string') return [];
      return [{
        name: x.name,
        url: x.browser_download_url,
        size: typeof x.size === 'number' ? x.size : 0,
        digest: typeof x.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(x.digest) ? x.digest.toLowerCase() : null,
      }];
    }),
  };
}

/** The installer for this platform: OpenNote-<version>-<mac|win|linux>-<arm64|x64|amd64>.<dmg|exe|deb>. */
export function pickAsset(release: Release, platform: NodeJS.Platform, arch: string): ReleaseAsset | null {
  const wanted =
    platform === 'darwin' ? `mac-${arch === 'arm64' ? 'arm64' : 'x64'}.dmg`
    : platform === 'win32' ? `win-${arch === 'arm64' ? 'arm64' : 'x64'}.exe`
    : platform === 'linux' ? `linux-${arch === 'arm64' ? 'arm64' : 'amd64'}.deb`
    : null;
  if (!wanted) return null;
  return release.assets.find((a) => a.name.endsWith(`-${wanted}`) && a.url.startsWith(DOWNLOAD_PREFIX)) ?? null;
}

export async function checkForUpdate(current: string, fetchImpl: typeof fetch = fetch): Promise<CheckResult> {
  try {
    const res = await fetchImpl(API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenNote-updater' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: 'error', message: `GitHub answered ${res.status}` };
    const release = parseRelease(await res.json());
    if (!release) return { status: 'error', message: 'Unexpected answer from GitHub' };
    return compareVersions(release.version, current) > 0 ? { status: 'available', current, release } : { status: 'uptodate', current };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Downloads an installer into `dir` and verifies size and SHA-256. Returns the file path. */
export async function downloadAsset(
  asset: ReleaseAsset,
  dir: string,
  onProgress: (fraction: number) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!asset.url.startsWith(DOWNLOAD_PREFIX)) throw new Error('Refusing to download from an unexpected address');
  if (!/^[\w.-]+$/.test(asset.name)) throw new Error('Unexpected file name');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, asset.name);
  const partial = `${target}.part`;
  const res = await fetchImpl(asset.url, { headers: { 'User-Agent': 'OpenNote-updater' }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const hash = createHash('sha256');
  let received = 0;
  const total = asset.size || Number(res.headers.get('content-length')) || 0;
  try {
    await pipeline(
      Readable.fromWeb(res.body as never),
      new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          received += chunk.length;
          if (total) onProgress(Math.min(1, received / total));
          cb(null, chunk);
        },
      }),
      createWriteStream(partial),
    );
    if (asset.size && received !== asset.size) throw new Error('The downloaded file has the wrong size');
    if (asset.digest && `sha256:${hash.digest('hex')}` !== asset.digest) throw new Error('The downloaded file failed its checksum');
  } catch (err) {
    rmSync(partial, { force: true });
    throw err;
  }
  rmSync(target, { force: true });
  renameSync(partial, target);
  return target;
}

// ------------------------------------------------------------------ macOS

/** Path of the .app bundle that contains the running executable, or null when not running from a bundle. */
export function bundlePath(exePath: string): string | null {
  const m = /^(.*?\.app)\/Contents\/MacOS\//.exec(exePath);
  return m ? m[1]! : null;
}

/** App Translocation and mounted disk images are read-only copies: updating them in place would be pointless. */
export const isTransientLocation = (bundle: string) => bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/');

/** Mounts the dmg, copies the app out to `stageDir` and unmounts. Returns the staged .app path. */
export async function stageMacApp(dmg: string, stageDir: string): Promise<string> {
  const mount = join(stageDir, 'mnt');
  mkdirSync(mount, { recursive: true });
  await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-noautoopen', '-mountpoint', mount, dmg]);
  try {
    const app = readdirSync(mount).find((n) => n.endsWith('.app'));
    if (!app) throw new Error('No app inside the disk image');
    const staged = join(stageDir, app);
    rmSync(staged, { recursive: true, force: true });
    await run('ditto', [join(mount, app), staged]);
    await run('codesign', ['--verify', '--deep', '--strict', staged]);
    return staged;
  } finally {
    await run('hdiutil', ['detach', '-force', mount]).catch(() => undefined);
  }
}

/**
 * Shell script that waits for the running app to exit, swaps the bundle and relaunches it. The old bundle is kept until the
 * new one is in place and put back if the copy fails. Arguments: <pid> <target.app> <staged.app>.
 */
export const macSwapScript = `#!/bin/sh
pid="$1"; target="$2"; staged="$3"; old="$target.old-update"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -gt 150 ] && exit 1
  sleep 0.2
done
rm -rf "$old"
mv "$target" "$old" || exit 1
if ditto "$staged" "$target"; then
  rm -rf "$old" "$staged"
  [ -n "$OPENNOTE_NO_RELAUNCH" ] || open "$target"
else
  rm -rf "$target"
  mv "$old" "$target"
  [ -n "$OPENNOTE_NO_RELAUNCH" ] || open "$target"
  exit 1
fi
`;

/** Starts the swap script detached, so it outlives this process. */
export function launchMacSwap(scriptPath: string, pid: number, target: string, staged: string): void {
  spawn('/bin/sh', [scriptPath, String(pid), target, staged], { detached: true, stdio: 'ignore' }).unref();
}

/** Runs the NSIS installer silently and starts the new version afterwards. */
export function launchWindowsInstaller(installer: string): void {
  spawn(installer, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
}
