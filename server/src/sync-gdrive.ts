/**
 * SyncTransport over Google Drive's hidden *application data folder* (scope `drive.appdata`): OpenNote can neither see nor touch
 * anything else in the user's Drive, and the user does not see these files in Drive. Only `fetch` is used, so it runs in the
 * browser and in Node alike. See docs/SYNC-BACKENDS.md.
 *
 * Drive has no real paths, so every record is one flat file whose *name* is the full path (`notes/<id>/<device>.json`).
 * One paginated listing per sync run builds an index of all names; reads, existence checks and listings then use the
 * index, and only changed files are downloaded (`version` is Drive's md5Checksum).
 */
import { checkPath, type SyncTransport, type TransportEntry } from './sync-transport.js';
import { SyncError } from './sync.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,md5Checksum,size,createdTime';
/** Drive's simple/multipart upload limit; bigger bodies use the resumable protocol. */
const SIMPLE_LIMIT = 5 * 1024 * 1024;
const MAX_ATTEMPTS = 4;

export interface DriveOptions {
  /** An OAuth access token for the drive.appdata scope. `forceRefresh` asks for a new one after a 401. */
  getToken: (forceRefresh: boolean) => Promise<string>;
  fetch?: typeof fetch;
  /** Waits between retries (tests make it instant). */
  sleep?: (ms: number) => Promise<void>;
}

interface DriveFile {
  id: string;
  name: string;
  md5Checksum?: string;
  size?: string;
  createdTime?: string;
}

const earlier = (a: DriveFile, b: DriveFile) => ((a.createdTime ?? '') <= (b.createdTime ?? '') ? a : b);

export class GoogleDriveTransport implements SyncTransport {
  private index: Map<string, DriveFile> | null = null;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: DriveOptions) {
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ------------------------------------------------------------------ HTTP

  /** One authenticated request with retries: a new token after 401, backoff on 429 and 5xx. */
  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    let refreshed = false;
    for (let attempt = 1; ; attempt++) {
      const token = await this.opts.getToken(refreshed);
      const res = await this.doFetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
      if (res.ok) return res;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        await this.sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
        continue;
      }
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      if (res.status === 401) throw new SyncError('Google Drive rejected the sign-in: connect again');
      if (res.status === 403 && /storageQuotaExceeded|quota/i.test(detail)) throw new SyncError('Your Google Drive storage is full');
      if (res.status === 403) throw new SyncError(`Google Drive refused the request (403). ${detail}`);
      throw new SyncError(`Google Drive error ${res.status}. ${detail}`);
    }
  }

  // ----------------------------------------------------------------- index

  private async load(): Promise<Map<string, DriveFile>> {
    if (this.index) return this.index;
    const index = new Map<string, DriveFile>();
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        spaces: 'appDataFolder', pageSize: '1000', q: 'trashed = false', fields: `nextPageToken,files(${FIELDS})`,
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = (await (await this.call(`${API}/files?${params}`)).json()) as { files?: DriveFile[]; nextPageToken?: string };
      for (const f of page.files ?? []) {
        const seen = index.get(f.name);
        index.set(f.name, seen ? earlier(seen, f) : f); // a name written twice by a race: the oldest one is the real one
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    this.index = index;
    return index;
  }

  // ------------------------------------------------------------- transport

  async list(dir: string): Promise<TransportEntry[]> {
    const prefix = checkPath(dir).join('/');
    const out = new Map<string, string>();
    for (const [path, f] of await this.load()) {
      if (prefix && !path.startsWith(`${prefix}/`)) continue;
      const rest = prefix ? path.slice(prefix.length + 1) : path;
      const slash = rest.indexOf('/');
      if (slash >= 0) out.set(rest.slice(0, slash), 'dir');
      else out.set(rest, f.md5Checksum ?? f.size ?? f.id);
    }
    return [...out].map(([name, version]) => ({ name, version }));
  }

  async exists(path: string): Promise<boolean> {
    checkPath(path);
    return (await this.load()).has(path);
  }

  async read(path: string): Promise<Buffer | null> {
    checkPath(path);
    const f = (await this.load()).get(path);
    if (!f) return null;
    try {
      return Buffer.from(await (await this.call(`${API}/files/${f.id}?alt=media`)).arrayBuffer());
    } catch (err) {
      if (err instanceof SyncError && /error 404/.test(err.message)) {
        (await this.load()).delete(path); // deleted by another device since we listed
        return null;
      }
      throw err;
    }
  }

  async write(path: string, data: Buffer): Promise<void> {
    checkPath(path);
    const index = await this.load();
    const existing = index.get(path);
    const file = existing ? await this.update(existing.id, data) : await this.create(path, data);
    index.set(path, file);
  }

  async writeIfAbsent(path: string, data: Buffer): Promise<boolean> {
    checkPath(path);
    const index = await this.load();
    if (index.has(path)) return false;
    const mine = await this.create(path, data);
    // Drive cannot create "only if absent": if another device created the same name at the same moment, the oldest wins.
    const params = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${path}' and trashed = false`, fields: `files(${FIELDS})` });
    const same = ((await (await this.call(`${API}/files?${params}`)).json()) as { files?: DriveFile[] }).files ?? [mine];
    const winner = same.reduce(earlier, mine);
    if (winner.id !== mine.id) {
      await this.call(`${API}/files/${mine.id}`, { method: 'DELETE' }).catch(() => undefined);
      index.set(path, winner);
      return false;
    }
    index.set(path, mine);
    return true;
  }

  async remove(path: string): Promise<void> {
    checkPath(path);
    const index = await this.load();
    const f = index.get(path);
    if (!f) return;
    try {
      await this.call(`${API}/files/${f.id}`, { method: 'DELETE' });
    } catch (err) {
      if (!(err instanceof SyncError && /error 404/.test(err.message))) throw err;
    }
    index.delete(path);
  }

  // --------------------------------------------------------------- uploads

  private async create(name: string, data: Buffer): Promise<DriveFile> {
    const meta = { name, parents: ['appDataFolder'] };
    if (data.length > SIMPLE_LIMIT) return this.resumable(`${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`, 'POST', meta, data);
    const boundary = `opennote-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      new Uint8Array(data),
      `\r\n--${boundary}--`,
    ]);
    const res = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return (await res.json()) as DriveFile;
  }

  private async update(id: string, data: Buffer): Promise<DriveFile> {
    if (data.length > SIMPLE_LIMIT) return this.resumable(`${UPLOAD}/files/${id}?uploadType=resumable&fields=${FIELDS}`, 'PATCH', {}, data);
    const res = await this.call(`${UPLOAD}/files/${id}?uploadType=media&fields=${FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(data),
    });
    return (await res.json()) as DriveFile;
  }

  /** Resumable upload in one request: start a session, then send all the bytes to the session address. */
  private async resumable(url: string, method: 'POST' | 'PATCH', meta: object, data: Buffer): Promise<DriveFile> {
    const start = await this.call(url, {
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream' },
      body: JSON.stringify(meta),
    });
    const session = start.headers.get('location');
    if (!session) throw new SyncError('Google Drive did not start the upload');
    const done = await this.call(session, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(data) });
    return (await done.json()) as DriveFile;
  }
}
