import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { NoteStore } from './store.js';
import { SyncEngine, startSyncScheduler } from './sync.js';

const dataDir = resolve(process.env.OPENNOTE_DATA ?? join(homedir(), '.opennote'));
const port = Number(process.env.PORT ?? 3737);
const webDist = resolve(fileURLToPath(new URL('../../web/dist', import.meta.url)));

const store = new NoteStore(openDb(join(dataDir, 'opennote.db')), join(dataDir, 'attachments'));
store.seedTemplates(process.env.LC_ALL || process.env.LANG || 'en');
const sync = new SyncEngine(store, { dataDir });
const app = createApp(store, sync);
startSyncScheduler(sync, console.warn);

if (existsSync(webDist)) {
  app.use('/*', serveStatic({ root: relativeTo(webDist) }));
  const index = readFileSync(join(webDist, 'index.html'), 'utf8');
  app.get('*', (c) => c.html(index));
}

// Bind to loopback only: your notes never leave this machine.
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`OpenNote running at http://localhost:${port}`);
  console.log(`Data directory: ${dataDir}`);
});

/** serve-static resolves `root` relative to the cwd. */
function relativeTo(abs: string): string {
  const rel = abs.startsWith(process.cwd()) ? abs.slice(process.cwd().length + 1) : abs;
  return rel || '.';
}
