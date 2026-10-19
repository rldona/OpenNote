import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { initSchema } from './schema.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Loaded via require: Vite's module graph (used by vitest) strips the `node:` prefix
// from `node:sqlite`, which then fails to resolve.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export function openDb(path: string): DatabaseSyncType {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  initSchema(db);
  return db;
}
