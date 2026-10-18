import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { NoteStore } from './store.js';
import { SyncEngine, startSyncScheduler } from './sync.js';

export interface StartOptions {
  /** 0 picks a free port. */
  port?: number;
  dataDir: string;
  /** Folder with the built web UI; the API alone is served when it does not exist. */
  webDist?: string;
  /** Language of the starter templates, e.g. "es_ES.UTF-8". */
  lang?: string;
  log?: (message: string) => void;
}

export interface RunningServer {
  port: number;
  url: string;
  dataDir: string;
  store: NoteStore;
  sync: SyncEngine;
  /** Stops sync and HTTP and closes the database cleanly (matters on Windows, where SQLite files stay locked). */
  close(): Promise<void>;
}

/** serve-static resolves `root` relative to the working directory. */
function relativeTo(abs: string): string {
  const cwd = process.cwd();
  const rel = abs.startsWith(cwd + '/') || abs.startsWith(cwd + '\\') ? abs.slice(cwd.length + 1) : abs;
  return rel || '.';
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const dataDir = resolve(opts.dataDir);
  const store = new NoteStore(openDb(join(dataDir, 'opennote.db')), join(dataDir, 'attachments'));
  store.seedTemplates(opts.lang ?? 'en');
  const sync = new SyncEngine(store, { dataDir });
  const app = createApp(store, sync);
  const stopSync = startSyncScheduler(sync, opts.log);

  if (opts.webDist && existsSync(join(opts.webDist, 'index.html'))) {
    const indexPath = join(opts.webDist, 'index.html');
    app.use('/*', serveStatic({ root: relativeTo(resolve(opts.webDist)) }));
    // Read on every request so a rebuilt UI is picked up without restarting.
    app.get('*', (c) => c.html(readFileSync(indexPath, 'utf8')));
  }

  // Bind to loopback only: your notes never leave this machine.
  const server = await new Promise<ReturnType<typeof serve>>((ok, fail) => {
    const s = serve({ fetch: app.fetch, port: opts.port ?? 0, hostname: '127.0.0.1' }, () => ok(s));
    s.once('error', fail);
  });
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    url: `http://localhost:${port}`,
    dataDir,
    store,
    sync,
    async close() {
      stopSync();
      await new Promise<void>((done) => {
        server.close(() => done());
        (server as Server).closeAllConnections?.();
      });
      store.close();
    },
  };
}
