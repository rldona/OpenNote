/**
 * The small slice of SQL access OpenNote's store needs. Node's built-in `node:sqlite` (`DatabaseSync`) satisfies it as is;
 * the browser build supplies an adapter over sqlite-wasm. Keeping the surface this small is what makes the two
 * interchangeable (see docs/SYNC-BACKENDS.md, phase 1).
 *
 * Contract: parameters are positional (`?`), rows are plain objects keyed by column name, and every call is synchronous.
 */
export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlStatement {
  run(...params: SqlValue[]): unknown;
  /** The first row, or undefined when there is none. */
  get(...params: SqlValue[]): Record<string, any> | undefined;
  all(...params: SqlValue[]): Record<string, any>[];
}

export interface SqlDatabase {
  /** Runs one or more statements without parameters or results (schema, BEGIN/COMMIT, simple updates). */
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}
