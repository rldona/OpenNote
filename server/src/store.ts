import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { htmlToText, snippet } from './html.js';

export interface Notebook {
  id: string;
  name: string;
  stack: string | null;
  createdAt: number;
  noteCount: number;
}

export interface NoteSummary {
  id: string;
  notebookId: string;
  title: string;
  snippet: string;
  pinned: boolean;
  trashedAt: number | null;
  reminderAt: number | null;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  attachmentCount: number;
}

export interface Note extends NoteSummary {
  content: string;
  sourceUrl: string | null;
}

export interface Attachment {
  id: string;
  noteId: string;
  filename: string;
  mime: string;
  size: number;
  md5: string;
  createdAt: number;
}

export interface NoteInput {
  notebookId?: string;
  title?: string;
  content?: string;
  pinned?: boolean;
  reminderAt?: number | null;
  sourceUrl?: string | null;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface ListFilter {
  notebookId?: string;
  tag?: string;
  q?: string;
  trashed?: boolean;
  pinned?: boolean;
  reminders?: boolean;
  limit?: number;
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

const VERSION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_VERSIONS = 50;

type Row = Record<string, SQLInputValue | null> & Record<string, any>;

export interface ParsedQuery {
  match: string | null;
  tags: string[];
  notebooks: string[];
  todo: boolean | null;
  hasAttachment: boolean;
  hasReminder: boolean;
}

/**
 * Evernote-style search grammar: free words (prefix matched), "exact phrases",
 * tag:x, notebook:x, todo:true|false, resource:any, reminderTime:*.
 */
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = {
    match: null,
    tags: [],
    notebooks: [],
    todo: null,
    hasAttachment: false,
    hasReminder: false,
  };
  const terms: string[] = [];
  const re = /(\w+:)?(?:"([^"]*)"|(\S+))/g;
  for (const m of q.matchAll(re)) {
    const op = m[1]?.slice(0, -1).toLowerCase();
    const value = (m[2] ?? m[3] ?? '').trim();
    if (!value && op !== 'resource') continue;
    if (op === 'tag') out.tags.push(value);
    else if (op === 'notebook') out.notebooks.push(value);
    else if (op === 'todo') out.todo = value.toLowerCase() !== 'false';
    else if (op === 'resource') out.hasAttachment = true;
    else if (op === 'remindertime') out.hasReminder = true;
    else {
      const raw = op ? `${op}${value}` : value;
      if (m[2] !== undefined) {
        terms.push(`"${raw.replace(/"/g, '')}"`);
      } else {
        for (const word of raw.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) terms.push(`"${word}"*`);
      }
    }
  }
  out.match = terms.length ? terms.join(' ') : null;
  return out;
}

export class NoteStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly attachmentsDir: string,
  ) {
    mkdirSync(attachmentsDir, { recursive: true });
    if (this.count('notebooks') === 0) this.createNotebook('Notes');
  }

  private count(table: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Row).n as number;
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------------------------------------------------------------- notebooks

  listNotebooks(): Notebook[] {
    const rows = this.db
      .prepare(
        `SELECT nb.*, (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.trashed_at IS NULL) AS note_count
         FROM notebooks nb ORDER BY COALESCE(nb.stack, ''), nb.name COLLATE NOCASE`,
      )
      .all() as Row[];
    return rows.map(toNotebook);
  }

  getNotebook(id: string): Notebook {
    const row = this.db
      .prepare(
        `SELECT nb.*, (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.trashed_at IS NULL) AS note_count
         FROM notebooks nb WHERE id = ?`,
      )
      .get(id) as Row | undefined;
    if (!row) throw new NotFoundError('notebook not found');
    return toNotebook(row);
  }

  createNotebook(name: string, stack: string | null = null): Notebook {
    name = name.trim();
    if (!name) throw new ValidationError('name is required');
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO notebooks (id, name, stack, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, stack?.trim() || null, Date.now());
    return this.getNotebook(id);
  }

  findOrCreateNotebook(name: string): Notebook {
    const row = this.db
      .prepare('SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE')
      .get(name) as Row | undefined;
    return row ? this.getNotebook(row.id as string) : this.createNotebook(name);
  }

  updateNotebook(id: string, patch: { name?: string; stack?: string | null }): Notebook {
    const current = this.getNotebook(id);
    const name = patch.name !== undefined ? patch.name.trim() : current.name;
    if (!name) throw new ValidationError('name is required');
    const stack = patch.stack !== undefined ? patch.stack?.trim() || null : current.stack;
    this.db.prepare('UPDATE notebooks SET name = ?, stack = ? WHERE id = ?').run(name, stack, id);
    return this.getNotebook(id);
  }

  /** Deleting a notebook moves its notes to `moveTo` (default: first remaining notebook). */
  deleteNotebook(id: string, moveTo?: string): void {
    this.getNotebook(id);
    const others = this.listNotebooks().filter((n) => n.id !== id);
    if (others.length === 0) throw new ValidationError('cannot delete the last notebook');
    const target = moveTo ?? others[0]!.id;
    if (target === id || !others.some((n) => n.id === target)) {
      throw new ValidationError('invalid target notebook');
    }
    this.tx(() => {
      this.db.prepare('UPDATE notes SET notebook_id = ? WHERE notebook_id = ?').run(target, id);
      this.db.prepare('DELETE FROM notebooks WHERE id = ?').run(id);
    });
  }

  // -------------------------------------------------------------------- notes

  private defaultNotebookId(): string {
    return this.listNotebooks()[0]!.id;
  }

  createNote(input: NoteInput = {}): Note {
    const id = randomUUID();
    const now = Date.now();
    const notebookId = input.notebookId ?? this.defaultNotebookId();
    this.getNotebook(notebookId);
    const content = input.content ?? '';
    const text = htmlToText(content);
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO notes (id, notebook_id, title, content, text, pinned, reminder_at, source_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          notebookId,
          input.title ?? '',
          content,
          text,
          input.pinned ? 1 : 0,
          input.reminderAt ?? null,
          input.sourceUrl ?? null,
          input.createdAt ?? now,
          input.updatedAt ?? input.createdAt ?? now,
        );
      if (input.tags) this.setTags(id, input.tags);
      this.reindex(id);
    });
    return this.getNote(id);
  }

  getNote(id: string): Note {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new NotFoundError('note not found');
    return { ...this.toSummary(row), content: row.content as string, sourceUrl: (row.source_url as string) ?? null };
  }

  updateNote(id: string, patch: NoteInput): Note {
    const current = this.getNote(id);
    const title = patch.title ?? current.title;
    const content = patch.content ?? current.content;
    const notebookId = patch.notebookId ?? current.notebookId;
    if (patch.notebookId) this.getNotebook(patch.notebookId);
    const contentChanged = title !== current.title || content !== current.content;
    this.tx(() => {
      if (contentChanged) this.snapshotVersion(current);
      this.db
        .prepare(
          `UPDATE notes SET notebook_id = ?, title = ?, content = ?, text = ?, pinned = ?,
             reminder_at = ?, source_url = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          notebookId,
          title,
          content,
          contentChanged ? htmlToText(content) : (this.db.prepare('SELECT text FROM notes WHERE id = ?').get(id) as Row).text,
          (patch.pinned ?? current.pinned) ? 1 : 0,
          patch.reminderAt !== undefined ? patch.reminderAt : current.reminderAt,
          patch.sourceUrl !== undefined ? patch.sourceUrl : current.sourceUrl,
          patch.updatedAt ?? (contentChanged || patch.notebookId ? Date.now() : current.updatedAt),
          id,
        );
      if (patch.tags) this.setTags(id, patch.tags);
      this.reindex(id);
    });
    return this.getNote(id);
  }

  trashNote(id: string): void {
    this.getNote(id);
    this.db.prepare('UPDATE notes SET trashed_at = ? WHERE id = ?').run(Date.now(), id);
  }

  restoreNote(id: string): Note {
    this.getNote(id);
    this.db.prepare('UPDATE notes SET trashed_at = NULL WHERE id = ?').run(id);
    return this.getNote(id);
  }

  deleteNotePermanently(id: string): void {
    this.getNote(id);
    const files = this.listAttachments(id);
    this.tx(() => {
      this.db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(id);
      this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    });
    for (const a of files) this.removeBlobIfOrphan(a.id);
  }

  emptyTrash(): number {
    const rows = this.db.prepare('SELECT id FROM notes WHERE trashed_at IS NOT NULL').all() as Row[];
    for (const r of rows) this.deleteNotePermanently(r.id as string);
    return rows.length;
  }

  listNotes(filter: ListFilter = {}): NoteSummary[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    let join = '';
    const parsed = filter.q ? parseQuery(filter.q) : null;

    where.push(filter.trashed ? 'n.trashed_at IS NOT NULL' : 'n.trashed_at IS NULL');
    if (filter.notebookId) {
      where.push('n.notebook_id = ?');
      params.push(filter.notebookId);
    }
    if (filter.pinned) where.push('n.pinned = 1');
    if (filter.reminders || parsed?.hasReminder) where.push('n.reminder_at IS NOT NULL');

    const tags = [...(filter.tag ? [filter.tag] : []), ...(parsed?.tags ?? [])];
    for (const t of tags) {
      where.push(
        `EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id AND t.name = ? COLLATE NOCASE)`,
      );
      params.push(t);
    }
    for (const nb of parsed?.notebooks ?? []) {
      where.push('n.notebook_id IN (SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE)');
      params.push(nb);
    }
    if (parsed?.hasAttachment) where.push('EXISTS (SELECT 1 FROM attachments a WHERE a.note_id = n.id)');
    if (parsed?.todo === true) where.push(`n.content LIKE '%data-checked="false"%'`);
    if (parsed?.todo === false) {
      where.push(`n.content LIKE '%data-type="taskItem"%' AND n.content NOT LIKE '%data-checked="false"%'`);
    }
    if (parsed?.match) {
      join = 'JOIN notes_fts f ON f.note_id = n.id';
      where.push('notes_fts MATCH ?');
      params.push(parsed.match);
    }

    const order = parsed?.match ? 'n.pinned DESC, bm25(notes_fts, 0, 5, 1), n.updated_at DESC' : 'n.pinned DESC, n.updated_at DESC';
    const sql = `SELECT n.* FROM notes n ${join} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`;
    params.push(Math.min(filter.limit ?? 500, 5000));
    const rows = this.db.prepare(sql).all(...params) as Row[];
    return rows.map((r) => this.toSummary(r));
  }

  private toSummary(row: Row): NoteSummary {
    const id = row.id as string;
    const tags = (
      this.db
        .prepare('SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name COLLATE NOCASE')
        .all(id) as Row[]
    ).map((t) => t.name as string);
    const attachmentCount = (
      this.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE note_id = ?').get(id) as Row
    ).n as number;
    return {
      id,
      notebookId: row.notebook_id as string,
      title: row.title as string,
      snippet: snippet(row.text as string),
      pinned: row.pinned === 1,
      trashedAt: (row.trashed_at as number) ?? null,
      reminderAt: (row.reminder_at as number) ?? null,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      tags,
      attachmentCount,
    };
  }

  private reindex(id: string): void {
    const row = this.db.prepare('SELECT title, text FROM notes WHERE id = ?').get(id) as Row;
    this.db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(id);
    this.db
      .prepare('INSERT INTO notes_fts (note_id, title, body) VALUES (?, ?, ?)')
      .run(id, row.title as string, row.text as string);
  }

  // --------------------------------------------------------------------- tags

  listTags(): { name: string; count: number }[] {
    const rows = this.db
      .prepare(
        `SELECT t.name, COUNT(n.id) AS count FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id
         LEFT JOIN notes n ON n.id = nt.note_id AND n.trashed_at IS NULL
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
      )
      .all() as Row[];
    return rows.map((r) => ({ name: r.name as string, count: r.count as number }));
  }

  setTags(noteId: string, names: string[]): void {
    const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    this.db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
    for (const name of clean) {
      let tag = this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(name) as Row | undefined;
      if (!tag) {
        const id = randomUUID();
        this.db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, name);
        tag = { id };
      }
      this.db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, tag.id as string);
    }
    this.db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)');
  }

  // ------------------------------------------------------------- saved search

  listSavedSearches(): { id: string; name: string; query: string }[] {
    return this.db.prepare('SELECT id, name, query FROM saved_searches ORDER BY name COLLATE NOCASE').all() as any;
  }

  createSavedSearch(name: string, query: string) {
    if (!name.trim() || !query.trim()) throw new ValidationError('name and query are required');
    const id = randomUUID();
    this.db.prepare('INSERT INTO saved_searches (id, name, query) VALUES (?, ?, ?)').run(id, name.trim(), query.trim());
    return { id, name: name.trim(), query: query.trim() };
  }

  deleteSavedSearch(id: string): void {
    this.db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
  }

  // ----------------------------------------------------------------- versions

  private snapshotVersion(note: Note): void {
    if (!note.content && !note.title) return;
    const last = this.db
      .prepare('SELECT saved_at FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC LIMIT 1')
      .get(note.id) as Row | undefined;
    if (last && Date.now() - (last.saved_at as number) < VERSION_INTERVAL_MS) return;
    this.db
      .prepare('INSERT INTO note_versions (note_id, title, content, saved_at) VALUES (?, ?, ?, ?)')
      .run(note.id, note.title, note.content, Date.now());
    this.db
      .prepare(
        `DELETE FROM note_versions WHERE note_id = ? AND id NOT IN
         (SELECT id FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC LIMIT ?)`,
      )
      .run(note.id, note.id, MAX_VERSIONS);
  }

  listVersions(noteId: string): { id: number; title: string; savedAt: number }[] {
    this.getNote(noteId);
    const rows = this.db
      .prepare('SELECT id, title, saved_at FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC')
      .all(noteId) as Row[];
    return rows.map((r) => ({ id: r.id as number, title: r.title as string, savedAt: r.saved_at as number }));
  }

  restoreVersion(noteId: string, versionId: number): Note {
    const row = this.db
      .prepare('SELECT title, content FROM note_versions WHERE id = ? AND note_id = ?')
      .get(versionId, noteId) as Row | undefined;
    if (!row) throw new NotFoundError('version not found');
    return this.updateNote(noteId, { title: row.title as string, content: row.content as string });
  }

  // -------------------------------------------------------------- attachments

  private blobPath(id: string): string {
    return join(this.attachmentsDir, id);
  }

  addAttachment(noteId: string, file: { filename: string; mime: string; data: Uint8Array }): Attachment {
    this.getNote(noteId);
    const id = randomUUID();
    const buf = Buffer.from(file.data);
    const att: Attachment = {
      id,
      noteId,
      filename: file.filename || 'file',
      mime: file.mime || 'application/octet-stream',
      size: buf.length,
      md5: createHash('md5').update(buf).digest('hex'),
      createdAt: Date.now(),
    };
    writeFileSync(this.blobPath(id), buf);
    this.db
      .prepare(
        `INSERT INTO attachments (id, note_id, filename, mime, size, md5, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, noteId, att.filename, att.mime, att.size, att.md5, createHash('sha256').update(buf).digest('hex'), att.createdAt);
    return att;
  }

  listAttachments(noteId: string): Attachment[] {
    const rows = this.db
      .prepare('SELECT * FROM attachments WHERE note_id = ? ORDER BY created_at')
      .all(noteId) as Row[];
    return rows.map(toAttachment);
  }

  getAttachment(id: string): Attachment & { data: Buffer } {
    const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Row | undefined;
    if (!row || !existsSync(this.blobPath(id))) throw new NotFoundError('attachment not found');
    return { ...toAttachment(row), data: readFileSync(this.blobPath(id)) };
  }

  deleteAttachment(id: string): void {
    const row = this.db.prepare('SELECT id FROM attachments WHERE id = ?').get(id);
    if (!row) throw new NotFoundError('attachment not found');
    this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    this.removeBlobIfOrphan(id);
  }

  private removeBlobIfOrphan(id: string): void {
    const still = this.db.prepare('SELECT 1 FROM attachments WHERE id = ?').get(id);
    if (!still) rmSync(this.blobPath(id), { force: true });
  }
}

function toNotebook(row: Row): Notebook {
  return {
    id: row.id as string,
    name: row.name as string,
    stack: (row.stack as string) ?? null,
    createdAt: row.created_at as number,
    noteCount: row.note_count as number,
  };
}

function toAttachment(row: Row): Attachment {
  return {
    id: row.id as string,
    noteId: row.note_id as string,
    filename: row.filename as string,
    mime: row.mime as string,
    size: row.size as number,
    md5: row.md5 as string,
    createdAt: row.created_at as number,
  };
}
