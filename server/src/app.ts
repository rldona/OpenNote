import { Hono } from 'hono';
import { exportEnex, importEnex } from './enex.js';
import { noteToMarkdown } from './markdown.js';
import { sanitizeHtml } from './html.js';
import { NoteStore, NotFoundError, ValidationError, type NoteInput } from './store.js';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const INLINE_MIME = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|audio\/|video\/)/;

function safeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
}

export function createApp(store: NoteStore): Hono {
  const app = new Hono();

  // The API controls local files, so only accept requests addressed to this machine
  // (blocks DNS rebinding) and non-GET requests coming from our own origin (blocks CSRF).
  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? '';
    if (!LOCAL_HOST.test(host)) return c.text('forbidden host', 403);
    const origin = c.req.header('origin');
    if (origin && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      if (new URL(origin).host !== host) return c.text('forbidden origin', 403);
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
  });

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });

  const body = async (c: { req: { json: () => Promise<any> } }) => {
    try {
      return (await c.req.json()) ?? {};
    } catch {
      throw new ValidationError('invalid JSON body');
    }
  };

  // ---------------------------------------------------------------- notebooks
  app.get('/api/notebooks', (c) => c.json(store.listNotebooks()));
  app.post('/api/notebooks', async (c) => {
    const b = await body(c);
    return c.json(store.createNotebook(String(b.name ?? ''), b.stack ?? null), 201);
  });
  app.patch('/api/notebooks/:id', async (c) => c.json(store.updateNotebook(c.req.param('id'), await body(c))));
  app.delete('/api/notebooks/:id', (c) => {
    store.deleteNotebook(c.req.param('id'), c.req.query('moveTo'));
    return c.body(null, 204);
  });

  // -------------------------------------------------------------------- notes
  app.get('/api/notes', (c) => {
    const q = c.req.query();
    return c.json(
      store.listNotes({
        notebookId: q.notebook,
        tag: q.tag,
        q: q.q,
        trashed: q.trashed === 'true',
        pinned: q.pinned === 'true',
        reminders: q.reminders === 'true',
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    );
  });
  app.post('/api/notes', async (c) => c.json(store.createNote(pickNoteInput(await body(c))), 201));
  app.get('/api/notes/:id', (c) => c.json(store.getNote(c.req.param('id'))));
  app.patch('/api/notes/:id', async (c) => c.json(store.updateNote(c.req.param('id'), pickNoteInput(await body(c)))));
  app.delete('/api/notes/:id', (c) => {
    if (c.req.query('permanent') === 'true') store.deleteNotePermanently(c.req.param('id'));
    else store.trashNote(c.req.param('id'));
    return c.body(null, 204);
  });
  app.post('/api/notes/:id/restore', (c) => c.json(store.restoreNote(c.req.param('id'))));
  app.delete('/api/trash', (c) => c.json({ deleted: store.emptyTrash() }));

  app.get('/api/notes/:id/versions', (c) => c.json(store.listVersions(c.req.param('id'))));
  app.post('/api/notes/:id/versions/:versionId/restore', (c) =>
    c.json(store.restoreVersion(c.req.param('id'), Number(c.req.param('versionId')))),
  );

  // --------------------------------------------------------------------- tags
  app.get('/api/tags', (c) => c.json(store.listTags()));

  app.get('/api/searches', (c) => c.json(store.listSavedSearches()));
  app.post('/api/searches', async (c) => {
    const b = await body(c);
    return c.json(store.createSavedSearch(String(b.name ?? ''), String(b.query ?? '')), 201);
  });
  app.delete('/api/searches/:id', (c) => {
    store.deleteSavedSearch(c.req.param('id'));
    return c.body(null, 204);
  });

  // -------------------------------------------------------------- attachments
  app.post('/api/notes/:id/attachments', async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new ValidationError('multipart field "file" is required');
    const att = store.addAttachment(c.req.param('id'), {
      filename: file.name,
      mime: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    });
    return c.json({ ...att, url: `/api/attachments/${att.id}` }, 201);
  });
  app.get('/api/notes/:id/attachments', (c) => c.json(store.listAttachments(c.req.param('id'))));
  app.get('/api/attachments/:id', (c) => {
    const att = store.getAttachment(c.req.param('id'));
    const inline = INLINE_MIME.test(att.mime);
    // User files are untrusted: never let them run script in our origin.
    c.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    c.header('Content-Type', inline ? att.mime : 'application/octet-stream');
    c.header(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${safeFilename(att.filename)}"`,
    );
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(new Uint8Array(att.data));
  });
  app.delete('/api/attachments/:id', (c) => {
    store.deleteAttachment(c.req.param('id'));
    return c.body(null, 204);
  });

  // ------------------------------------------------------------ import/export
  app.post('/api/import/enex', async (c) => {
    const xml = await c.req.text();
    try {
      return c.json(importEnex(store, xml, c.req.query('notebook') ?? 'Imported'), 201);
    } catch (err) {
      if (err instanceof Error && err.message.includes('ENEX')) throw new ValidationError(err.message);
      throw err;
    }
  });
  app.get('/api/export/enex', (c) => {
    const noteId = c.req.query('note');
    const notebookId = c.req.query('notebook');
    const notes = noteId
      ? [store.getNote(noteId)]
      : store.listNotes({ notebookId, limit: 5000 }).map((n) => store.getNote(n.id));
    c.header('Content-Type', 'application/xml; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="opennote-export.enex"');
    return c.body(exportEnex(store, notes));
  });
  app.get('/api/notes/:id/export.md', (c) => {
    const note = store.getNote(c.req.param('id'));
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${safeFilename(note.title || 'note')}.md"`);
    return c.body(noteToMarkdown(note, store.listAttachments(note.id)));
  });

  return app;
}

function pickNoteInput(b: Record<string, unknown>): NoteInput {
  const out: NoteInput = {};
  if (typeof b.notebookId === 'string') out.notebookId = b.notebookId;
  if (typeof b.title === 'string') out.title = b.title.slice(0, 500);
  if (typeof b.content === 'string') out.content = sanitizeHtml(b.content);
  if (typeof b.pinned === 'boolean') out.pinned = b.pinned;
  if (b.reminderAt === null || typeof b.reminderAt === 'number') out.reminderAt = b.reminderAt as number | null;
  if (b.sourceUrl === null || typeof b.sourceUrl === 'string') out.sourceUrl = b.sourceUrl as string | null;
  if (Array.isArray(b.tags)) out.tags = b.tags.map(String);
  return out;
}
