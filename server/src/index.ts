import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './start.js';

const server = await startServer({
  port: Number(process.env.PORT ?? 3737),
  dataDir: process.env.OPENNOTE_DATA ?? join(homedir(), '.opennote'),
  webDist: resolve(fileURLToPath(new URL('../../web/dist', import.meta.url))),
  lang: process.env.LC_ALL || process.env.LANG || 'en',
  log: console.warn,
});

console.log(`OpenNote running at ${server.url}`);
console.log(`Data directory: ${server.dataDir}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void server.close().then(() => process.exit(0)));
}
