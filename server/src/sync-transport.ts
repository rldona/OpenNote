/**
 * Where synced data is stored. The sync engine (sync.ts) only talks to this interface, so the same merge logic works over a
 * shared folder, Google Drive, WebDAV, S3… and in the browser. See docs/SYNC-BACKENDS.md.
 *
 * Paths are relative, `/`-separated and made of safe segments only: `format.json`, `devices/<id>.json`,
 * `notes/<noteId>/<deviceId>.json`, `attachments/<name>`. Implementations must make `write` atomic (readers never see
 * half a file) and must never let a path escape their root.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface TransportEntry {
  name: string;
  /** Changes whenever the content changes (mtime+size, ETag, md5…). Lets the engine skip files it already parsed. */
  version: string;
}

export interface SyncTransport {
  /** Files and folders directly inside `dir` ("" is the root). A missing folder is an empty list. */
  list(dir: string): Promise<TransportEntry[]>;
  /** Content of a file, or null when it does not exist. */
  read(path: string): Promise<Buffer | null>;
  /** Creates or replaces a file atomically. Parent folders are created as needed. */
  write(path: string, data: Buffer): Promise<void>;
  /** Creates the file only if it does not exist yet. Returns false when somebody else created it first. */
  writeIfAbsent(path: string, data: Buffer): Promise<boolean>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

const SEGMENT = /^[\w][\w.-]*$/;

/** Rejects anything that is not a plain relative path. Shared by every implementation. */
export function checkPath(path: string): string[] {
  const parts = path === '' ? [] : path.split('/');
  for (const p of parts) if (!SEGMENT.test(p) || p === '..') throw new Error(`unsafe sync path: ${path}`);
  return parts;
}

/** A directory on disk (a folder kept in sync by Syncthing, iCloud, Dropbox, Google Drive for desktop, a USB drive…). */
export class FolderTransport implements SyncTransport {
  constructor(private readonly root: string) {}

  private abs(path: string): string {
    return join(this.root, ...checkPath(path));
  }

  async list(dir: string): Promise<TransportEntry[]> {
    const names = await readdir(this.abs(dir)).catch(() => [] as string[]);
    const out: TransportEntry[] = [];
    for (const name of names) {
      if (name.includes('.tmp-') || !SEGMENT.test(name)) continue; // half-written files and anything odd
      const st = await stat(join(this.abs(dir), name)).catch(() => null);
      if (st) out.push({ name, version: `${st.mtimeMs}:${st.size}` });
    }
    return out;
  }

  async read(path: string): Promise<Buffer | null> {
    return readFile(this.abs(path)).catch(() => null);
  }

  async write(path: string, data: Buffer): Promise<void> {
    const file = this.abs(path);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  }

  async writeIfAbsent(path: string, data: Buffer): Promise<boolean> {
    const file = this.abs(path);
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(file, data, { flag: 'wx' });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }

  async remove(path: string): Promise<void> {
    await rm(this.abs(path), { force: true });
  }

  async exists(path: string): Promise<boolean> {
    return stat(this.abs(path)).then(() => true, () => false);
  }
}

/** Keeps everything in memory. Used by tests, and as the reference for how a transport must behave. */
export class MemoryTransport implements SyncTransport {
  private readonly files = new Map<string, { data: Buffer; version: number }>();
  private counter = 0;

  async list(dir: string): Promise<TransportEntry[]> {
    const prefix = checkPath(dir).join('/');
    const seen = new Map<string, string>();
    for (const [path, f] of this.files) {
      if (prefix && !path.startsWith(`${prefix}/`)) continue;
      const rest = prefix ? path.slice(prefix.length + 1) : path;
      const name = rest.split('/')[0]!;
      seen.set(name, rest.includes('/') ? 'dir' : String(f.version));
    }
    return [...seen].map(([name, version]) => ({ name, version }));
  }

  async read(path: string): Promise<Buffer | null> {
    checkPath(path);
    const f = this.files.get(path);
    return f ? Buffer.from(f.data) : null;
  }

  async write(path: string, data: Buffer): Promise<void> {
    checkPath(path);
    this.files.set(path, { data: Buffer.from(data), version: ++this.counter });
  }

  async writeIfAbsent(path: string, data: Buffer): Promise<boolean> {
    checkPath(path);
    if (this.files.has(path)) return false;
    await this.write(path, data);
    return true;
  }

  async remove(path: string): Promise<void> {
    checkPath(path);
    this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    checkPath(path);
    return this.files.has(path);
  }
}
