/**
 * The OpenNote server running inside the browser: the very same Hono app and NoteStore as the desktop and command line
 * versions, on sqlite-wasm with the database stored in the browser's private file system (OPFS).
 *
 * A Web Lock makes sure only one worker owns the database at a time (the OPFS pool needs exclusive access).
 */
import './polyfills';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createApp } from '../../../server/src/app';
import { SqlBlobStore } from '../../../server/src/blobs-sql';
import { initSchema } from '../../../server/src/schema';
import { wasmDatabase, type WasmDb } from '../../../server/src/sql-wasm';
import { NoteStore } from '../../../server/src/store';
import { GoogleDriveTransport } from '../../../server/src/sync-gdrive';
import { SyncEngine, SyncError, startSyncScheduler } from '../../../server/src/sync';
import type { ApiRequest, ApiResponse, TokenReply, TokenRequest, WorkerStatus } from './protocol';

/** `self` as a dedicated worker (the web tsconfig only knows the Window flavour of postMessage). */
const ctx = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void };
const status = (s: WorkerStatus) => ctx.postMessage(s);

/** Access tokens come from the page (Google sign-in needs a window). */
const waitingForToken = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
let tokenIds = 0;
const getToken = (force: boolean) =>
  new Promise<string>((resolve, reject) => {
    const id = ++tokenIds;
    waitingForToken.set(id, { resolve, reject });
    const req: TokenRequest = { type: 'token-request', id, force };
    ctx.postMessage(req);
  });

/** "Chrome on macOS": a recognisable default name for this device in the sync status. */
function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

let sqlite3: any;

async function open() {
  sqlite3 = await (sqlite3InitModule as unknown as (o: object) => Promise<any>)({ print() {}, printErr() {} });
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'opennote' });
  const db = wasmDatabase(new pool.OpfsSAHPoolDb('/opennote.db') as WasmDb);
  initSchema(db);
  const store = new NoteStore(db, new SqlBlobStore(db));
  store.seedTemplates(navigator.language);
  const sync = new SyncEngine(store, {
    dataDir: '',
    deviceName: deviceName(),
    transport: () => new GoogleDriveTransport({ getToken }),
    remoteLabel: 'Google Drive',
    requireEncryption: true,
  });
  return { app: createApp(store, sync, undefined, undefined, { standalone: true }), sync };
}

const HOLD_FOREVER = new Promise<never>(() => {});

void navigator.locks.request('opennote-db', { ifAvailable: true }, async (lock) => {
  if (!lock) return status({ type: 'locked' });
  let app: Awaited<ReturnType<typeof open>>['app'];
  try {
    const opened = await open();
    app = opened.app;
    startSyncScheduler(opened.sync, (msg) => console.warn(msg));
  } catch (err) {
    return status({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
  }

  self.onmessage = async (event: MessageEvent<ApiRequest | TokenReply | { type: 'selftest' }>) => {
    const m = event.data;
    if (m?.type === 'token') {
      const waiting = waitingForToken.get(m.id);
      waitingForToken.delete(m.id);
      if (m.token) waiting?.resolve(m.token);
      else waiting?.reject(new SyncError(m.error ?? 'Could not get a Google access token'));
      return;
    }
    if (m?.type === 'selftest') {
      const { selfTest } = await import('./selftest');
      return ctx.postMessage({ type: 'selftest-result', result: await selfTest(sqlite3) });
    }
    if (m?.type !== 'request') return;
    let reply: ApiResponse;
    try {
      const noBody = m.method === 'GET' || m.method === 'HEAD' || m.body === null;
      const res = await app.fetch(new Request(`${self.location.origin}${m.url}`, { method: m.method, headers: m.headers, body: noBody ? undefined : m.body }));
      reply = { type: 'response', id: m.id, status: res.status, statusText: res.statusText, headers: [...res.headers], body: await res.arrayBuffer() };
    } catch (err) {
      const body = new TextEncoder().encode(JSON.stringify({ error: err instanceof Error ? err.message : 'internal error' })).buffer as ArrayBuffer;
      reply = { type: 'response', id: m.id, status: 500, statusText: 'Internal Server Error', headers: [['content-type', 'application/json']], body };
    }
    ctx.postMessage(reply, [reply.body]);
  };
  status({ type: 'ready' });
  await HOLD_FOREVER; // keep the lock until the worker is terminated (tab closed)
});
