/**
 * SqlDatabase over sqlite-wasm (`sqlite3.oo1.DB`). This is what the browser build uses; it is also run in Node by the test
 * suite (`npm run test:wasm`) to prove the store behaves the same on both engines. No Node imports.
 */
import type { SqlDatabase, SqlStatement, SqlValue } from './sql.js';

/** The part of sqlite-wasm's `oo1.DB` used here, declared locally so this file needs no import of the package. */
export interface WasmDb {
  exec(arg: string | { sql: string; bind?: unknown[] }): unknown;
  selectObject(sql: string, bind?: unknown[]): Record<string, any> | undefined;
  selectObjects(sql: string, bind?: unknown[]): Record<string, any>[];
  close(): void;
}

export function wasmDatabase(db: WasmDb): SqlDatabase {
  // sqlite-wasm refuses an empty bind list on a statement without parameters, so only pass one when there are values.
  const bind = (params: SqlValue[]) => (params.length ? params : undefined);
  const statement = (sql: string): SqlStatement => ({
    run: (...params: SqlValue[]) => {
      db.exec({ sql, bind: bind(params) });
    },
    get: (...params: SqlValue[]) => db.selectObject(sql, bind(params)),
    all: (...params: SqlValue[]) => db.selectObjects(sql, bind(params)),
  });
  return {
    exec: (sql) => void db.exec(sql),
    prepare: statement,
    close: () => db.close(),
  };
}
