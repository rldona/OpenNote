import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractTasks, htmlToText, patchTaskItem, snippet } from './html.js';

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

export interface Task {
  noteId: string;
  noteTitle: string;
  notebookId: string;
  idx: number;
  text: string;
  checked: boolean;
  due: string | null;
}

export interface TaskFilter {
  status?: 'open' | 'done' | 'all';
  due?: 'overdue' | 'today' | 'week' | 'none' | 'any';
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
  templates?: boolean;
  pinned?: boolean;
  reminders?: boolean;
  limit?: number;
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

const VERSION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_VERSIONS = 50;

type Row = Record<string, SQLInputValue | null> & Record<string, any>;

export interface DateRange {
  after?: number;
  before?: number;
}

export interface ParsedQuery {
  /** Positive FTS5 expression, or null when the query has no free text. */
  match: string | null;
  /** FTS5 expression of terms that must NOT appear. */
  exclude: string | null;
  tags: string[];
  notTags: string[];
  notebooks: string[];
  notNotebooks: string[];
  todo: boolean | null;
  hasAttachment: boolean | null;
  hasReminder: boolean | null;
  created: DateRange;
  updated: DateRange;
  sourceUrl: string[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Start (local time) of a search date: 20240131, day, day-1, week, month-2, year... */
export function parseSearchDate(value: string, now = new Date()): number | null {
  const abs = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/.exec(value);
  if (abs) return new Date(+abs[1]!, +abs[2]! - 1, +abs[3]!, +(abs[4] ?? 0), +(abs[5] ?? 0), +(abs[6] ?? 0)).getTime();
  const rel = /^(day|week|month|year)(?:-(\d+))?$/i.exec(value);
  if (!rel) return null;
  const n = Number(rel[2] ?? 0);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (rel[1]!.toLowerCase()) {
    case 'day':
      return d.getTime() - n * DAY;
    case 'week': {
      const monday = new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY);
      return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * n).getTime();
    }
    case 'month':
      return new Date(d.getFullYear(), d.getMonth() - n, 1).getTime();
    default:
      return new Date(d.getFullYear() - n, 0, 1).getTime();
  }
}

/**
 * Evernote-style search grammar. Free words are prefix matched, "quoted phrases" are exact.
 * Operators: tag: notebook: todo: resource:any reminderTime:* created: updated: sourceUrl:
 * intitle: any: and a leading `-` to negate any term or operator.
 * `created:`/`updated:` take 20240131, day, day-1, week, month-3, year (start of that period);
 * `-created:X` means before X.
 */
export function parseQuery(q: string, now = new Date()): ParsedQuery {
  const out: ParsedQuery = {
    match: null,
    exclude: null,
    tags: [],
    notTags: [],
    notebooks: [],
    notNotebooks: [],
    todo: null,
    hasAttachment: null,
    hasReminder: null,
    created: {},
    updated: {},
    sourceUrl: [],
  };
  const anyMode = /(^|\s)any:(?=\s|$)/i.test(q);
  const positive: string[] = [];
  const negative: string[] = [];
  const re = /(-)?(\w+:)?(?:"([^"]*)"|(\S+))/g;
  for (const m of q.replace(/(^|\s)any:(?=\s|$)/gi, ' ').matchAll(re)) {
    const neg = m[1] === '-';
    const op = m[2]?.slice(0, -1).toLowerCase();
    const value = (m[3] ?? m[4] ?? '').trim();
    if (!value) continue;
    const dateOp = op === 'created' || op === 'updated';
    if (op === 'tag') (neg ? out.notTags : out.tags).push(value);
    else if (op === 'notebook') (neg ? out.notNotebooks : out.notebooks).push(value);
    else if (op === 'todo') out.todo = neg ? value.toLowerCase() === 'false' : value.toLowerCase() !== 'false';
    else if (op === 'resource') out.hasAttachment = !neg;
    else if (op === 'remindertime') out.hasReminder = !neg;
    else if (op === 'sourceurl') out.sourceUrl.push(value);
    else if (dateOp) {
      const ts = parseSearchDate(value, now);
      if (ts !== null) out[op][neg ? 'before' : 'after'] = ts;
    } else {
      const raw = op && op !== 'intitle' ? `${op}:${value}` : value;
      const col = op === 'intitle' ? 'title : ' : '';
      const terms =
        m[3] !== undefined
          ? [`${col}"${raw.replace(/"/g, '')}"`]
          : raw.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => `${col}"${w}"*`);
      (neg ? negative : positive).push(...terms);
    }
  }
  out.match = positive.length ? positive.join(anyMode ? ' OR ' : ' ') : null;
  out.exclude = negative.length ? negative.join(' OR ') : null;
  return out;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class NoteStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly attachmentsDir: string,
  ) {
    mkdirSync(attachmentsDir, { recursive: true });
    if (this.count('notebooks') === 0) this.createNotebook('Notes');
    this.backfillTasks();
  }

  private count(table: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Row).n as number;
  }

  private txDepth = 0;

  /** Runs fn atomically. Nested calls join the outer transaction (an error rolls back everything). */
  private tx<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.db.exec('BEGIN');
    this.txDepth = 1;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.txDepth = 0;
    }
  }

  // ---------------------------------------------------------------- notebooks

  listNotebooks(): Notebook[] {
    const rows = this.db
      .prepare(
        `SELECT nb.*, (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.trashed_at IS NULL AND n.is_template = 0) AS note_count
         FROM notebooks nb ORDER BY COALESCE(nb.stack, ''), nb.name COLLATE NOCASE`,
      )
      .all() as Row[];
    return rows.map(toNotebook);
  }

  getNotebook(id: string): Notebook {
    const row = this.db
      .prepare(
        `SELECT nb.*, (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.trashed_at IS NULL AND n.is_template = 0) AS note_count
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

  findOrCreateNotebook(name: string, stack: string | null = null): Notebook {
    const row = this.db
      .prepare('SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE')
      .get(name) as Row | undefined;
    return row ? this.getNotebook(row.id as string) : this.createNotebook(name, stack);
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
    where.push(filter.templates ? 'n.is_template = 1' : 'n.is_template = 0');
    if (filter.notebookId) {
      where.push('n.notebook_id = ?');
      params.push(filter.notebookId);
    }
    if (filter.pinned) where.push('n.pinned = 1');
    if (filter.reminders) where.push('n.reminder_at IS NOT NULL');

    // A tag also matches its descendants: tag:work finds work/projects/alpha.
    const tagExists = (negate: boolean) =>
      `${negate ? 'NOT ' : ''}EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id
         AND (t.name = ? COLLATE NOCASE OR t.name LIKE ? ESCAPE '\\'))`;
    for (const tag of [...(filter.tag ? [filter.tag] : []), ...(parsed?.tags ?? [])]) {
      where.push(tagExists(false));
      params.push(tag, `${likeEscape(tag)}/%`);
    }
    for (const tag of parsed?.notTags ?? []) {
      where.push(tagExists(true));
      params.push(tag, `${likeEscape(tag)}/%`);
    }
    for (const nb of parsed?.notebooks ?? []) {
      where.push('n.notebook_id IN (SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE)');
      params.push(nb);
    }
    for (const nb of parsed?.notNotebooks ?? []) {
      where.push('n.notebook_id NOT IN (SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE)');
      params.push(nb);
    }
    if (parsed?.hasAttachment !== null && parsed?.hasAttachment !== undefined) {
      where.push(`${parsed.hasAttachment ? '' : 'NOT '}EXISTS (SELECT 1 FROM attachments a WHERE a.note_id = n.id)`);
    }
    if (parsed?.hasReminder !== null && parsed?.hasReminder !== undefined) {
      where.push(parsed.hasReminder ? 'n.reminder_at IS NOT NULL' : 'n.reminder_at IS NULL');
    }
    if (parsed?.todo === true) where.push(`n.content LIKE '%data-checked="false"%'`);
    if (parsed?.todo === false) {
      where.push(`n.content LIKE '%data-type="taskItem"%' AND n.content NOT LIKE '%data-checked="false"%'`);
    }
    for (const [col, range] of [['n.created_at', parsed?.created], ['n.updated_at', parsed?.updated]] as const) {
      if (range?.after !== undefined) { where.push(`${col} >= ?`); params.push(range.after); }
      if (range?.before !== undefined) { where.push(`${col} < ?`); params.push(range.before); }
    }
    for (const src of parsed?.sourceUrl ?? []) {
      where.push(`n.source_url LIKE ? ESCAPE '\\'`);
      params.push(`%${likeEscape(src)}%`);
    }
    if (parsed?.match) {
      join = 'JOIN notes_fts f ON f.note_id = n.id';
      where.push('notes_fts MATCH ?');
      params.push(parsed.match);
    }
    if (parsed?.exclude) {
      where.push('n.id NOT IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?)');
      params.push(parsed.exclude);
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
    this.syncTasks(id);
  }

  // -------------------------------------------------------------------- tasks

  private syncTasks(noteId: string): void {
    const row = this.db.prepare('SELECT content FROM notes WHERE id = ?').get(noteId) as Row;
    this.db.prepare('DELETE FROM tasks WHERE note_id = ?').run(noteId);
    const insert = this.db.prepare('INSERT INTO tasks (note_id, idx, text, checked, due) VALUES (?, ?, ?, ?, ?)');
    for (const t of extractTasks(row.content as string)) insert.run(noteId, t.idx, t.text, t.checked ? 1 : 0, t.due);
  }

  /** Tasks created before the tasks table existed are indexed once on startup. */
  private backfillTasks(): void {
    const version = (this.db.prepare('PRAGMA user_version').get() as Row).user_version as number;
    if (version >= 1) return;
    const ids = this.db.prepare('SELECT id FROM notes').all() as Row[];
    this.tx(() => ids.forEach((r) => this.syncTasks(r.id as string)));
    this.db.exec('PRAGMA user_version = 1');
  }

  private static localDay(offsetDays = 0): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  listTasks(filter: TaskFilter = {}): Task[] {
    const where = ['n.trashed_at IS NULL', 'n.is_template = 0'];
    const params: SQLInputValue[] = [];
    const status = filter.status ?? 'open';
    if (status !== 'all') where.push(`t.checked = ${status === 'done' ? 1 : 0}`);
    const today = NoteStore.localDay();
    switch (filter.due) {
      case 'overdue': where.push('t.due < ?'); params.push(today); break;
      case 'today': where.push('t.due = ?'); params.push(today); break;
      case 'week': where.push('t.due >= ? AND t.due <= ?'); params.push(today, NoteStore.localDay(7)); break;
      case 'none': where.push('t.due IS NULL'); break;
      case 'any': where.push('t.due IS NOT NULL'); break;
    }
    const rows = this.db
      .prepare(
        `SELECT t.*, n.title, n.notebook_id FROM tasks t JOIN notes n ON n.id = t.note_id
         WHERE ${where.join(' AND ')}
         ORDER BY t.due IS NULL, t.due, n.updated_at DESC, t.idx LIMIT 2000`,
      )
      .all(...params) as Row[];
    return rows.map((r) => ({
      noteId: r.note_id as string,
      noteTitle: r.title as string,
      notebookId: r.notebook_id as string,
      idx: r.idx as number,
      text: r.text as string,
      checked: r.checked === 1,
      due: (r.due as string) ?? null,
    }));
  }

  /** Check/uncheck a task or change its due date by rewriting the note's checklist item. */
  updateTask(noteId: string, idx: number, patch: { checked?: boolean; due?: string | null }): Note {
    if (patch.due && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) throw new ValidationError('due must be YYYY-MM-DD');
    const note = this.getNote(noteId);
    const html = patchTaskItem(note.content, idx, patch);
    if (html === null) throw new NotFoundError('task not found');
    return this.updateNote(noteId, { content: html });
  }

  // --------------------------------------------------------------------- tags

  /**
   * Tags form a hierarchy through "/" (work/projects/alpha). Ancestors that no note uses directly
   * are returned too (`virtual`) so clients can render a tree. `count` = notes with exactly this tag,
   * `total` = distinct notes in this tag or any descendant.
   */
  listTags(): { name: string; count: number; total: number; virtual: boolean }[] {
    const rows = this.db
      .prepare(
        `SELECT t.name AS name, n.id AS note_id FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id
         LEFT JOIN notes n ON n.id = nt.note_id AND n.trashed_at IS NULL AND n.is_template = 0`,
      )
      .all() as Row[];
    const own = new Map<string, Set<string>>();
    const real = new Set<string>();
    for (const r of rows) {
      const name = r.name as string;
      real.add(name);
      const set = own.get(name) ?? new Set();
      if (r.note_id) set.add(r.note_id as string);
      own.set(name, set);
    }
    for (const name of [...real]) {
      const parts = name.split('/');
      for (let i = 1; i < parts.length; i++) {
        const ancestor = parts.slice(0, i).join('/');
        if (![...own.keys()].some((k) => k.toLowerCase() === ancestor.toLowerCase())) own.set(ancestor, new Set());
      }
    }
    const names = [...own.keys()].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }));
    return names.map((name) => {
      const prefix = `${name.toLowerCase()}/`;
      const all = new Set<string>();
      for (const [k, ids] of own) {
        if (k.toLowerCase() === name.toLowerCase() || k.toLowerCase().startsWith(prefix)) ids.forEach((id) => all.add(id));
      }
      return { name, count: own.get(name)!.size, total: all.size, virtual: !real.has(name) };
    });
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

  // --------------------------------------------------------------- templates

  private static fill(text: string): string {
    const now = new Date();
    const day = NoteStore.localDay();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return text.replace(/\{\{\s*date\s*\}\}/g, day).replace(/\{\{\s*time\s*\}\}/g, time);
  }

  listTemplates(): NoteSummary[] {
    return this.listNotes({ templates: true });
  }

  /** Copies a note into the template library. {{date}} and {{time}} are filled in when it is used. */
  saveAsTemplate(noteId: string): Note {
    const src = this.getNote(noteId);
    const copy = this.createNote({ notebookId: src.notebookId, title: src.title || 'Template', content: src.content });
    this.db.prepare('UPDATE notes SET is_template = 1 WHERE id = ?').run(copy.id);
    this.copyAttachments(src.id, copy.id);
    return this.getNote(copy.id);
  }

  createFromTemplate(templateId: string, notebookId?: string): Note {
    const tpl = this.getNote(templateId);
    const isTemplate = this.db.prepare('SELECT is_template FROM notes WHERE id = ?').get(templateId) as Row;
    if (isTemplate.is_template !== 1) throw new ValidationError('not a template');
    const created = this.createNote({ notebookId, title: NoteStore.fill(tpl.title), content: NoteStore.fill(tpl.content) });
    return this.copyAttachments(tpl.id, created.id);
  }

  /** Seeds a few starter templates once, in the user's language. */
  seedTemplates(lang: string): void {
    const version = (this.db.prepare('PRAGMA user_version').get() as Row).user_version as number;
    if (version >= 2) return;
    const es = lang.toLowerCase().startsWith('es');
    const task = (text: string) => `<li data-type="taskItem" data-checked="false"><p>${text}</p></li>`;
    const list = (...items: string[]) => `<ul data-type="taskList">${items.map(task).join('')}</ul>`;
    const templates = es
      ? [
          ['Acta de reunión', '<h2>Reunión {{date}}</h2><p><b>Asistentes:</b> </p><h3>Temas</h3><ul><li><p></p></li></ul><h3>Decisiones</h3><p></p><h3>Acciones</h3>' + list('')],
          ['Lista de tareas', '<h2>Tareas de {{date}}</h2>' + list('', '', '')],
          ['Revisión semanal', '<h2>Semana del {{date}}</h2><h3>Logros</h3><ul><li><p></p></li></ul><h3>Pendiente</h3>' + list('') + '<h3>Prioridades de la próxima semana</h3><ol><li><p></p></li></ol>'],
          ['Plan de proyecto', '<h2>Proyecto</h2><p><b>Objetivo:</b> </p><h3>Hitos</h3>' + list('', '') + '<h3>Riesgos</h3><ul><li><p></p></li></ul>'],
        ]
      : [
          ['Meeting notes', '<h2>Meeting {{date}}</h2><p><b>Attendees:</b> </p><h3>Agenda</h3><ul><li><p></p></li></ul><h3>Decisions</h3><p></p><h3>Action items</h3>' + list('')],
          ['To-do list', '<h2>To-do {{date}}</h2>' + list('', '', '')],
          ['Weekly review', '<h2>Week of {{date}}</h2><h3>Wins</h3><ul><li><p></p></li></ul><h3>Open items</h3>' + list('') + '<h3>Next week priorities</h3><ol><li><p></p></li></ol>'],
          ['Project plan', '<h2>Project</h2><p><b>Goal:</b> </p><h3>Milestones</h3>' + list('', '') + '<h3>Risks</h3><ul><li><p></p></li></ul>'],
        ];
    this.tx(() => {
      for (const [title, content] of templates) {
        const n = this.createNote({ title: title!, content: content! });
        this.db.prepare('UPDATE notes SET is_template = 1 WHERE id = ?').run(n.id);
      }
      this.db.exec('PRAGMA user_version = 2');
    });
  }

  // -------------------------------------------------- duplicate, merge, links

  /** Copies attachment files to another note and points that note's content at the copies. */
  private copyAttachments(fromId: string, toId: string): Note {
    const idMap = new Map<string, string>();
    for (const a of this.listAttachments(fromId)) {
      const { data } = this.getAttachment(a.id);
      idMap.set(a.id, this.addAttachment(toId, { filename: a.filename, mime: a.mime, data }).id);
    }
    if (idMap.size) {
      let content = this.getNote(toId).content;
      for (const [oldId, newId] of idMap) content = content.split(`/api/attachments/${oldId}`).join(`/api/attachments/${newId}`);
      this.db.prepare('UPDATE notes SET content = ?, text = ? WHERE id = ?').run(content, htmlToText(content), toId);
      this.reindex(toId);
    }
    return this.getNote(toId);
  }

  duplicateNote(id: string, suffix = ' (copy)'): Note {
    const src = this.getNote(id);
    const copy = this.createNote({
      notebookId: src.notebookId,
      title: `${src.title || ''}${suffix}`.trim(),
      content: src.content,
      tags: src.tags,
      sourceUrl: src.sourceUrl,
    });
    return this.copyAttachments(src.id, copy.id);
  }

  /** Appends the other notes (in order) to the first one, moves their files and tags, and trashes them. */
  mergeNotes(ids: string[]): Note {
    const unique = [...new Set(ids)];
    if (unique.length < 2) throw new ValidationError('select at least two notes to merge');
    const notes = unique.map((id) => this.getNote(id));
    const [target, ...rest] = notes as [Note, ...Note[]];
    this.tx(() => {
      let content = target.content;
      const tags = new Set(target.tags);
      for (const n of rest) {
        content += `<hr><h2>${escapeHtml(n.title || '')}</h2>${n.content}`;
        n.tags.forEach((t) => tags.add(t));
        this.db.prepare('UPDATE attachments SET note_id = ? WHERE note_id = ?').run(target.id, n.id);
      }
      this.updateNote(target.id, { content, tags: [...tags] });
      for (const n of rest) this.db.prepare('UPDATE notes SET trashed_at = ? WHERE id = ?').run(Date.now(), n.id);
    });
    return this.getNote(target.id);
  }

  /** Notes that link to this one through a #/note/<id> link. */
  backlinks(id: string): { id: string; title: string }[] {
    this.getNote(id);
    const rows = this.db
      .prepare(
        `SELECT id, title FROM notes WHERE trashed_at IS NULL AND is_template = 0 AND id != ?
         AND content LIKE ? ESCAPE '\\' ORDER BY updated_at DESC`,
      )
      .all(id, `%#/note/${likeEscape(id)}%`) as Row[];
    return rows.map((r) => ({ id: r.id as string, title: r.title as string }));
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

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
