/**
 * Serverless sync through a shared folder (Syncthing, iCloud Drive, Dropbox, USB, NAS…).
 * See docs/SYNC.md for the format and the merge rules.
 *
 * Every device only ever writes its own files, so a file-sync tool never has to merge anything:
 *   <folder>/opennote-sync/format.json
 *   <folder>/opennote-sync/devices/<deviceId>.json
 *   <folder>/opennote-sync/notes/<noteId>/<deviceId>.json   latest version of the note on that device
 *   <folder>/opennote-sync/attachments/<sha256 | hmac>      attachment bytes
 * Version vectors tell "newer" from "edited concurrently"; concurrent edits keep both versions.
 */
import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual,
} from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { NoteStore, SyncNote } from './store.js';

export const SYNC_FORMAT_VERSION = 1;
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const ID = /^[0-9a-f-]{36}$/;
const DEVICE_ID = /^[\w-]{8,64}$/;
const BLOB_NAME = /^[0-9a-f]{64}$/;
const MAGIC = Buffer.from('ONS1');

export class SyncError extends Error {}

interface Stats {
  pushed: number;
  pulled: number;
  deleted: number;
  conflicts: SyncConflict[];
}

type VV = Record<string, number>;

interface Record_ {
  v: number;
  id: string;
  deviceId: string;
  deviceName: string;
  vv: VV;
  writtenAt: number;
  deleted?: boolean;
  note?: SyncNote;
  chk?: string;
}

export interface SyncConflict {
  noteId: string;
  title: string;
  at: number;
}

export interface SyncStatus {
  running: boolean;
  lastRunAt: number | null;
  ok: boolean;
  pushed: number;
  pulled: number;
  deleted: number;
  conflicts: SyncConflict[];
  errors: string[];
}

export interface SyncConfig {
  folder: string | null;
  enabled: boolean;
  intervalMinutes: number;
  encrypted: boolean;
  deviceName: string;
}

// ------------------------------------------------------------- vector clocks

type Order = 'equal' | 'before' | 'after' | 'concurrent';

export function compareVV(a: VV, b: VV): Order {
  let aAhead = false;
  let bAhead = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    if (x > y) aAhead = true;
    if (y > x) bAhead = true;
  }
  if (aAhead && bAhead) return 'concurrent';
  if (aAhead) return 'after';
  if (bAhead) return 'before';
  return 'equal';
}

const maxVV = (...all: VV[]): VV => {
  const out: VV = {};
  for (const v of all) for (const [k, n] of Object.entries(v)) out[k] = Math.max(out[k] ?? 0, n);
  return out;
};

// ------------------------------------------------------------------- crypto

class Codec {
  constructor(private readonly key: Buffer | null) {}

  get encrypted() {
    return this.key !== null;
  }

  encode(data: Buffer): Buffer {
    if (!this.key) return data;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
  }

  decode(data: Buffer): Buffer {
    if (!this.key) return data;
    if (data.length < 32 || !data.subarray(0, 4).equals(MAGIC)) throw new SyncError('file is not encrypted');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(4, 16));
    decipher.setAuthTag(data.subarray(16, 32));
    try {
      return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()]);
    } catch {
      throw new SyncError('could not decrypt (wrong passphrase or corrupted file)');
    }
  }

  /** Name of an attachment blob. Encrypted folders do not reveal content hashes. */
  blobName(sha256: string): string {
    return this.key ? createHmac('sha256', this.key).update(sha256).digest('hex') : sha256;
  }
}

const deriveKey = (passphrase: string, salt: Buffer) => scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

// ------------------------------------------------------------------- helpers

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** Hash of the syncable content, independent of key order. */
export function noteHash(n: SyncNote): string {
  return sha(
    JSON.stringify([
      n.id, n.notebook.name, n.notebook.stack, n.title, n.content, n.pinned, n.trashedAt, n.reminderAt, n.sourceUrl,
      n.createdAt, n.updatedAt, n.isTemplate, [...n.tags].sort(),
      n.attachments.map((a) => [a.id, a.filename, a.mime, a.sha256]),
    ]),
  );
}

function checksum(r: Record_): string {
  const { chk: _chk, ...rest } = r;
  return sha(JSON.stringify(rest));
}

async function writeAtomic(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

const exists = async (p: string) => stat(p).then(() => true, () => false);

/** A UUID derived from text, so two devices create the very same conflict copy. */
function derivedId(text: string): string {
  const h = sha(text);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// -------------------------------------------------------------------- engine

export class SyncEngine {
  private running = false;
  private status: SyncStatus = { running: false, lastRunAt: null, ok: true, pushed: 0, pulled: 0, deleted: 0, conflicts: [], errors: [] };
  private cache = new Map<string, { mtime: number; size: number; rec: Record_ | null }>();

  constructor(
    private readonly store: NoteStore,
    private readonly opts: { dataDir: string; deviceName?: string },
  ) {
    const saved = store.getMeta('sync.status');
    if (saved) this.status = { ...this.status, ...JSON.parse(saved), running: false };
  }

  // ----------------------------------------------------------------- config

  get deviceId(): string {
    let id = this.store.getMeta('device.id');
    if (!id) {
      id = randomUUID();
      this.store.setMeta('device.id', id);
    }
    return id;
  }

  get deviceName(): string {
    return this.store.getMeta('device.name') ?? this.opts.deviceName ?? hostname();
  }

  getConfig(): SyncConfig & { hasPassphrase: boolean } {
    const passphrase = this.store.getMeta('sync.passphrase');
    return {
      folder: this.store.getMeta('sync.folder'),
      enabled: this.store.getMeta('sync.enabled') === '1',
      intervalMinutes: Number(this.store.getMeta('sync.interval') ?? 5),
      encrypted: !!passphrase,
      hasPassphrase: !!passphrase,
      deviceName: this.deviceName,
    };
  }

  setConfig(patch: { folder?: string | null; enabled?: boolean; intervalMinutes?: number; passphrase?: string | null; deviceName?: string }): void {
    if (patch.folder !== undefined) {
      if (patch.folder === null || patch.folder === '') this.store.setMeta('sync.folder', null);
      else this.store.setMeta('sync.folder', this.validateFolder(patch.folder));
    }
    if (patch.enabled !== undefined) {
      if (patch.enabled && !(patch.folder ?? this.store.getMeta('sync.folder'))) throw new SyncError('choose a folder first');
      this.store.setMeta('sync.enabled', patch.enabled ? '1' : '0');
    }
    if (patch.intervalMinutes !== undefined) {
      const n = Math.round(patch.intervalMinutes);
      if (!(n >= 1 && n <= 1440)) throw new SyncError('interval must be between 1 and 1440 minutes');
      this.store.setMeta('sync.interval', String(n));
    }
    if (patch.passphrase !== undefined) this.store.setMeta('sync.passphrase', patch.passphrase ? patch.passphrase : null);
    if (patch.deviceName !== undefined && patch.deviceName.trim()) this.store.setMeta('device.name', patch.deviceName.trim().slice(0, 80));
  }

  /** The folder must exist, be a directory, and must not be inside OpenNote's own data directory. */
  private validateFolder(input: string): string {
    const folder = resolve(input);
    if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new SyncError('the folder does not exist');
    const data = resolve(this.opts.dataDir);
    if (folder === data || folder.startsWith(data + sep)) throw new SyncError('the sync folder cannot be inside the OpenNote data folder');
    return folder;
  }

  getStatus(): SyncStatus {
    return { ...this.status, running: this.running };
  }

  // -------------------------------------------------------------------- run

  async run(): Promise<SyncStatus> {
    if (this.running) return this.getStatus();
    const folder = this.store.getMeta('sync.folder');
    if (!folder) throw new SyncError('no sync folder configured');
    this.running = true;
    const stats = { pushed: 0, pulled: 0, deleted: 0, conflicts: [] as SyncConflict[], errors: [] as string[] };
    let fatal: string | null = null;
    try {
      const codec = await this.openFolder(this.validateFolder(folder));
      await this.syncAll(join(resolve(folder), 'opennote-sync'), codec, stats);
    } catch (err) {
      fatal = err instanceof Error ? err.message : String(err);
    } finally {
      this.running = false;
    }
    this.status = {
      running: false,
      lastRunAt: Date.now(),
      ok: fatal === null && stats.errors.length === 0,
      pushed: stats.pushed,
      pulled: stats.pulled,
      deleted: stats.deleted,
      conflicts: stats.conflicts,
      errors: fatal ? [fatal, ...stats.errors] : stats.errors,
    };
    this.store.setMeta('sync.status', JSON.stringify(this.status));
    return this.getStatus();
  }

  /** Creates the folder structure on first use and returns the codec matching it. */
  private async openFolder(folder: string): Promise<Codec> {
    const root = join(folder, 'opennote-sync');
    const formatPath = join(root, 'format.json');
    const passphrase = this.store.getMeta('sync.passphrase');
    await mkdir(join(root, 'notes'), { recursive: true });
    await mkdir(join(root, 'attachments'), { recursive: true });
    await mkdir(join(root, 'devices'), { recursive: true });

    if (!(await exists(formatPath))) {
      const salt = randomBytes(16);
      const key = passphrase ? deriveKey(passphrase, salt) : null;
      const codec = new Codec(key);
      const format = {
        version: SYNC_FORMAT_VERSION,
        app: 'opennote',
        encrypted: !!passphrase,
        salt: passphrase ? salt.toString('base64') : undefined,
        verifier: passphrase ? codec.encode(Buffer.from('opennote')).toString('base64') : undefined,
      };
      // "wx": if another device initialised the folder first, theirs wins and we read it below.
      await writeFile(formatPath, JSON.stringify(format, null, 2), { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST') throw e;
      });
    }

    const format = JSON.parse(await readFile(formatPath, 'utf8')) as {
      version: number; encrypted: boolean; salt?: string; verifier?: string;
    };
    if (format.version > SYNC_FORMAT_VERSION) throw new SyncError('the sync folder was written by a newer OpenNote version');
    if (!format.encrypted) {
      if (passphrase) throw new SyncError('this sync folder is not encrypted; remove the passphrase or use a new folder');
      return new Codec(null);
    }
    if (!passphrase) throw new SyncError('this sync folder is encrypted: enter its passphrase');
    const codec = new Codec(deriveKey(passphrase, Buffer.from(format.salt!, 'base64')));
    const check = codec.decode(Buffer.from(format.verifier!, 'base64'));
    if (check.length !== 8 || !timingSafeEqual(check, Buffer.from('opennote'))) throw new SyncError('wrong passphrase');
    return codec;
  }

  // -------------------------------------------------------- read & write files

  private async readRecord(path: string, codec: Codec): Promise<Record_ | null> {
    try {
      const st = await stat(path);
      const hit = this.cache.get(path);
      if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.rec;
      const rec = JSON.parse(codec.decode(await readFile(path)).toString('utf8')) as Record_;
      const ok =
        rec && rec.v === SYNC_FORMAT_VERSION && ID.test(rec.id) && DEVICE_ID.test(rec.deviceId) &&
        typeof rec.vv === 'object' && rec.vv !== null && rec.chk === checksum(rec) &&
        (rec.deleted === true || (rec.note && rec.note.id === rec.id && typeof rec.note.content === 'string'));
      const result = ok ? rec : null;
      this.cache.set(path, { mtime: st.mtimeMs, size: st.size, rec: result });
      return result;
    } catch (err) {
      // Half-synced or damaged file: ignore it now, it is read again on the next run.
      if (err instanceof SyncError && /passphrase/.test(err.message)) throw err;
      return null;
    }
  }

  private async writeRecord(root: string, codec: Codec, rec: Record_): Promise<void> {
    rec.chk = checksum(rec);
    await writeAtomic(join(root, 'notes', rec.id, `${rec.deviceId}.json`), codec.encode(Buffer.from(JSON.stringify(rec))));
  }

  /** Reads every device's file of one note. */
  private async readNote(root: string, id: string, codec: Codec): Promise<Record_[]> {
    const dir = join(root, 'notes', id);
    const files = await readdir(dir).catch(() => [] as string[]);
    const out: Record_[] = [];
    for (const f of files) {
      if (!f.endsWith('.json') || !DEVICE_ID.test(f.slice(0, -5))) continue;
      const rec = await this.readRecord(join(dir, f), codec);
      if (rec && rec.id === id && `${rec.deviceId}.json` === f) out.push(rec);
    }
    return out;
  }

  private async ensureBlob(root: string, codec: Codec, sha256: string, attachmentId: string): Promise<void> {
    const path = join(root, 'attachments', codec.blobName(sha256));
    if (await exists(path)) return;
    await writeAtomic(path, codec.encode(this.store.attachmentData(attachmentId)));
  }

  private async readBlobs(root: string, codec: Codec, rec: SyncNote): Promise<Map<string, Buffer> | null> {
    const blobs = new Map<string, Buffer>();
    for (const a of rec.attachments) {
      if (this.store.hasAttachment(a.id)) continue;
      if (!BLOB_NAME.test(a.sha256)) return null;
      try {
        const data = codec.decode(await readFile(join(root, 'attachments', codec.blobName(a.sha256))));
        if (sha(data) !== a.sha256) return null;
        blobs.set(a.id, data);
      } catch {
        return null; // not synced yet
      }
    }
    return blobs;
  }

  // ------------------------------------------------------------------- merge

  private async syncAll(root: string, codec: Codec, stats: Stats & { errors: string[] }): Promise<void> {
    const me = this.deviceId;
    await writeAtomic(
      join(root, 'devices', `${me}.json`),
      codec.encode(Buffer.from(JSON.stringify({ id: me, name: this.deviceName, lastSeenAt: Date.now() }))),
    );

    const remoteIds = (await readdir(join(root, 'notes')).catch(() => [] as string[])).filter((n) => ID.test(n));
    const done = new Set<string>();
    // A second pass picks up notes created during the first one (conflict copies).
    for (let pass = 0; pass < 3; pass++) {
      const ids = new Set<string>([...this.store.syncNoteIds(), ...remoteIds, ...this.store.listTombstones().map((t) => t.noteId)]);
      const todo = [...ids].filter((id) => !done.has(id));
      if (!todo.length) break;
      for (const id of todo) {
        done.add(id);
        try {
          await this.syncNote(root, codec, id, stats);
        } catch (err) {
          if (err instanceof SyncError) throw err;
          stats.errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    await this.collectGarbage(root);
  }

  private async syncNote(root: string, codec: Codec, id: string, stats: Stats): Promise<void> {
    const me = this.deviceId;
    const all = await this.readNote(root, id, codec);
    const own = all.find((r) => r.deviceId === me);
    // Records no other record supersedes. Ours is handled separately.
    const frontier = all.filter((r) => r.deviceId !== me && !all.some((o) => o !== r && compareVV(o.vv, r.vv) === 'after'));

    const state = this.store.getSyncState(id);
    const tomb = this.store.listTombstones().find((t) => t.noteId === id);
    let base: VV = state?.vv ?? {};
    let local = tomb ? null : this.store.exportForSync(id);
    const localHash = local ? noteHash(local) : null;
    const localChanged = !!local && (!state || state.hash !== localHash);
    /** Our own record must be (re)written because local content is newer than what the folder holds. */
    let needPush = localChanged;

    // ---- pull: remote records we have not seen yet
    const fresh = frontier.filter((r) => {
      const o = compareVV(base, r.vv);
      return o !== 'after' && o !== 'equal';
    });
    if (fresh.length) {
      const live = fresh.filter((r) => !r.deleted && r.note);
      const winner = [...live].sort((x, y) => y.note!.updatedAt - x.note!.updatedAt || y.deviceId.localeCompare(x.deviceId))[0];
      const remoteVV = maxVV(...fresh.map((r) => r.vv));

      // Several devices edited concurrently: the losers are kept as conflict copies.
      for (const loser of live) {
        if (winner && loser !== winner && noteHash(loser.note!) !== noteHash(winner.note!)) await this.keepConflictCopy(loser, stats, root, codec);
      }

      if (!winner) {
        // Only deletions are new.
        if (local && !localChanged) {
          this.store.deleteForSync(id);
          this.store.deleteSyncState(id);
          if (own) await rm(join(root, 'notes', id, `${me}.json`), { force: true });
          stats.deleted++;
          return;
        }
        if (!local && !tomb) {
          this.store.setSyncState(id, remoteVV, 'deleted'); // nothing to delete; remember we saw it
          return;
        }
        // Edit beats delete: keep the local note (or our own deletion) and supersede the remote deletion.
        base = maxVV(base, remoteVV);
        needPush = true;
      } else {
        const blobs = await this.readBlobs(root, codec, winner.note!);
        if (blobs === null) return; // attachments still syncing: try again next run
        base = maxVV(base, remoteVV);
        if (!local) {
          // Unknown here, or deleted here but edited elsewhere (edit wins).
          this.store.applyFromSync(winner.note!, blobs);
          this.store.removeTombstone(id);
          stats.pulled++;
          needPush = false;
        } else if (noteHash(winner.note!) === localHash) {
          needPush = false; // same content: only the clocks need merging
        } else if (!localChanged) {
          this.store.applyFromSync(winner.note!, blobs);
          stats.pulled++;
          needPush = false;
        } else {
          // Both sides edited. The newest wins and the other version survives as a conflict copy.
          const localWins = local.updatedAt > winner.note!.updatedAt || (local.updatedAt === winner.note!.updatedAt && me > winner.deviceId);
          if (localWins) {
            await this.keepConflictCopy(winner, stats, root, codec);
            needPush = true;
          } else {
            await this.keepConflictCopy({ ...winner, note: local, deviceId: me, deviceName: this.deviceName }, stats, root, codec);
            this.store.applyFromSync(winner.note!, blobs);
            stats.pulled++;
            needPush = false;
          }
        }
        local = this.store.exportForSync(id);
        this.store.setSyncState(id, base, local ? noteHash(local) : 'deleted');
        if (!needPush) return;
      }
    }

    // ---- push: local edits and local deletions
    if (tomb && !this.store.hasNote(id)) {
      if (!state && !own) {
        this.store.removeTombstone(id); // never left this device
        return;
      }
      if (!tomb.pushed || needPush || (own && !own.deleted)) {
        const vv = { ...base, [me]: Math.max(base[me] ?? 0, own?.vv[me] ?? 0) + 1 };
        await this.writeRecord(root, codec, { v: SYNC_FORMAT_VERSION, id, deviceId: me, deviceName: this.deviceName, vv, writtenAt: Date.now(), deleted: true });
        this.store.setSyncState(id, vv, 'deleted');
        this.store.markTombstonePushed(id);
        stats.pushed++;
      }
      return;
    }

    if (!needPush || !local) return;
    for (const a of local.attachments) await this.ensureBlob(root, codec, a.sha256, a.id);
    const vv = { ...base, [me]: Math.max(base[me] ?? 0, own?.vv[me] ?? 0) + 1 };
    await this.writeRecord(root, codec, { v: SYNC_FORMAT_VERSION, id, deviceId: me, deviceName: this.deviceName, vv, writtenAt: Date.now(), note: local });
    this.store.setSyncState(id, vv, noteHash(local));
    stats.pushed++;
  }

  /** Bytes of an attachment: from this device if present, otherwise from the sync folder. */
  private async blobFor(root: string, codec: Codec, a: SyncNote['attachments'][number]): Promise<Buffer | null> {
    if (this.store.hasAttachment(a.id)) return this.store.attachmentData(a.id);
    try {
      const data = codec.decode(await readFile(join(root, 'attachments', codec.blobName(a.sha256))));
      return sha(data) === a.sha256 ? data : null;
    } catch {
      return null;
    }
  }

  /**
   * Saves a losing version as a new note. Its id, title and attachment ids come from the loser only,
   * so every device builds exactly the same copy and the copies do not conflict with each other.
   */
  private async keepConflictCopy(loser: Record_, stats: Stats, root: string, codec: Codec): Promise<void> {
    const n = loser.note!;
    const copyId = derivedId(`conflict:${loser.id}:${loser.deviceId}:${noteHash(n)}`);
    if (this.store.hasNote(copyId)) return;
    const title = `${n.title || 'Untitled'} (conflict ${loser.deviceName} ${day(n.updatedAt)})`;
    let content = n.content;
    const attachments: SyncNote['attachments'] = [];
    const blobs = new Map<string, Buffer>();
    for (const a of n.attachments) {
      const data = await this.blobFor(root, codec, a);
      if (!data) continue;
      const newId = derivedId(`${copyId}:${a.id}`);
      content = content.split(`/api/attachments/${a.id}`).join(`/api/attachments/${newId}`);
      attachments.push({ ...a, id: newId });
      blobs.set(newId, data);
    }
    this.store.applyFromSync({ ...n, id: copyId, title, content, pinned: false, reminderAt: null, attachments }, blobs);
    stats.conflicts.push({ noteId: copyId, title, at: Date.now() });
  }

  /** Our own tombstone files older than the TTL are removed; every device has had ample time to see them. */
  private async collectGarbage(root: string): Promise<void> {
    const me = this.deviceId;
    const now = Date.now();
    for (const t of this.store.listTombstones()) {
      if (!t.pushed || now - t.deletedAt < TOMBSTONE_TTL_MS) continue;
      await rm(join(root, 'notes', t.noteId, `${me}.json`), { force: true });
      this.store.removeTombstone(t.noteId);
      this.store.deleteSyncState(t.noteId);
    }
  }
}

// ----------------------------------------------------------------- scheduler

/** Runs sync on startup and then every `intervalMinutes` while enabled. Returns a stop function. */
export function startSyncScheduler(engine: SyncEngine, log: (msg: string) => void = () => {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const tick = async () => {
    const cfg = engine.getConfig();
    if (cfg.enabled && cfg.folder) {
      const s = await engine.run().catch((e) => ({ ok: false, errors: [String(e)] }) as Partial<SyncStatus>);
      if (!s.ok) log(`sync: ${(s.errors ?? []).join('; ')}`);
    }
    if (!stopped) timer = setTimeout(() => void tick(), Math.max(1, engine.getConfig().intervalMinutes) * 60_000);
  };
  timer = setTimeout(() => void tick(), 2_000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
