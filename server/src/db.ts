import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Loaded via require: Vite's module graph (used by vitest) strips the `node:` prefix
// from `node:sqlite`, which then fails to resolve.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stack TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  trashed_at INTEGER,
  reminder_at INTEGER,
  source_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_notebook ON notes(notebook_id);
CREATE INDEX IF NOT EXISTS notes_updated ON notes(updated_at);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  md5 TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_note ON attachments(note_id);

CREATE TABLE IF NOT EXISTS note_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS versions_note ON note_versions(note_id, saved_at);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  due TEXT,
  PRIMARY KEY (note_id, idx)
);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(due);

-- Text read from attachments (PDF, images by OCR, text files) so searches can find it. Local to each device.
CREATE TABLE IF NOT EXISTS attachment_text (
  attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Last synced vector clock and content hash of every note (see sync.ts).
CREATE TABLE IF NOT EXISTS sync_state (
  note_id TEXT PRIMARY KEY,
  vv TEXT NOT NULL,
  hash TEXT NOT NULL
);

-- Permanent deletions that still have to reach other devices.
CREATE TABLE IF NOT EXISTS sync_tombstones (
  note_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL,
  pushed INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  note_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

export function openDb(path: string): DatabaseSyncType {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Additive migrations for databases created by older versions. */
function migrate(db: DatabaseSyncType): void {
  const cols = (db.prepare('PRAGMA table_info(notes)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('is_template')) {
    db.exec('ALTER TABLE notes ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0');
  }
  // is_template = 2 marks built-in starter templates: per-device, never synced.
  const done = db.prepare("SELECT 1 FROM meta WHERE key = 'migration.builtin-templates'").get();
  if (!done) {
    db.exec(`UPDATE notes SET is_template = 2 WHERE is_template = 1 AND created_at = updated_at AND title IN
      ('Project plan','To-do list','Weekly review','Meeting notes','Plan de proyecto','Lista de tareas','Revisión semanal','Acta de reunión')`);
    db.exec("INSERT INTO meta (key, value) VALUES ('migration.builtin-templates', '1')");
  }
}
