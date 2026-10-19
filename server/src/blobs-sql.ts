/**
 * Attachment bytes kept inside the same SQL database as the notes. Used by the browser build, where there is no file system
 * to put them on. No Node imports.
 */
import type { BlobStore } from './blobs.js';
import type { SqlDatabase } from './sql.js';

export class SqlBlobStore implements BlobStore {
  constructor(private readonly db: SqlDatabase) {
    db.exec('CREATE TABLE IF NOT EXISTS attachment_blobs (id TEXT PRIMARY KEY, data BLOB NOT NULL)');
  }

  put(id: string, data: Uint8Array): void {
    this.db.prepare('INSERT OR REPLACE INTO attachment_blobs (id, data) VALUES (?, ?)').run(id, data);
  }

  get(id: string): Uint8Array | null {
    const row = this.db.prepare('SELECT data FROM attachment_blobs WHERE id = ?').get(id);
    return row ? new Uint8Array(row.data as ArrayLike<number>) : null;
  }

  has(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM attachment_blobs WHERE id = ?').get(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM attachment_blobs WHERE id = ?').run(id);
  }
}
