/**
 * Opens the database the tests run on. By default Node's built-in SQLite; with OPENNOTE_TEST_DRIVER=wasm the very same
 * tests run on sqlite-wasm (the engine the browser build uses), so any difference between the two shows up here.
 */
import { MemoryBlobStore } from '../src/blobs.js';
import { openDb } from '../src/db.js';
import { initSchema } from '../src/schema.js';
import type { SqlDatabase } from '../src/sql.js';
import { wasmDatabase, type WasmDb } from '../src/sql-wasm.js';

export const driver = process.env.OPENNOTE_TEST_DRIVER === 'wasm' ? 'wasm' : 'node';

interface Sqlite3 { oo1: { DB: new (file?: string) => WasmDb } }
let sqlite3: Sqlite3 | null = null;
if (driver === 'wasm') {
  const { default: init } = await import('@sqlite.org/sqlite-wasm');
  sqlite3 = (await (init as (options: object) => Promise<unknown>)({ print() {}, printErr() {} })) as Sqlite3;
}

export function openTestDb(): SqlDatabase {
  if (!sqlite3) return openDb(':memory:');
  const db = wasmDatabase(new sqlite3.oo1.DB(':memory:'));
  initSchema(db);
  return db;
}

/** Attachments for tests that do not care where they are kept. */
export const memoryBlobs = () => new MemoryBlobStore();
