import { Hono } from 'hono';
import { exportEnex, importEnex } from './enex.js';
import { clipPage, type ClipOptions } from './clip.js';
import type { AttachmentIndexer } from './indexer.js';
import { exportZip, importArchive, importFile, looksLikeZip } from './import.js';
import { noteToMarkdown } from './markdown.js';
import { sanitizeHtml } from './html.js';
import { NoteStore, NotFoundError, ValidationError, type NoteInput } from './store.js';
import type { GoogleConnection } from './google-connection.js';
import { SyncEngine, SyncError } from './sync.js';

/** Browser extensions may call the clip endpoint (and only it); web pages cannot forge this Origin. */
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\/[\w.-]+$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const INLINE_MIME = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|audio\/|video\/)/;

function safeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
}

export interface AppOptions {
  /**
   * The app runs inside the browser page itself (no network socket): requests come from our own page through a service
   * worker, so there is no foreign host or origin to guard against and the checks below are skipped.
   */
  standalone?: boolean;
  /** Google Drive sign-in through the local server (desktop app, command line). The browser build signs in on the page instead. */
  google?: GoogleConnection;
}

export function createApp(store: NoteStore, sync?: SyncEngine, clipOptions?: ClipOptions, indexer?: AttachmentIndexer, options: AppOptions = {}): Hono {
  const app = new Hono();

  // The API controls local files, so only accept requests addressed to this machine
  // (blocks DNS rebinding) and non-GET requests coming from our own origin (blocks CSRF).
  app.use('*', async (c, next) => {
    if (options.standalone) {
      await next();
      c.header('X-Content-Type-Options', 'nosniff');
      return;
    }
    const host = c.req.header('host') ?? '';
    if (!LOCAL_HOST.test(host)) return c.text('forbidden host', 403);
    const origin = c.req.header('origin');
    const clipFromExtension = c.req.path === '/api/clip' && !!origin && EXTENSION_ORIGIN.test(origin);
    if (clipFromExtension) {
      c.header('Access-Control-Allow-Origin', origin!);
      c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type');
      c.header('Vary', 'Origin');
      if (c.req.method === 'OPTIONS') return c.body(null, 204);
    } else if (origin && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      if (new URL(origin).host !== host) return c.text('forbidden origin', 403);
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
  });

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ValidationError || err instanceof SyncError) return c.json({ error: err.message }, 400);
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
  app.post('/api/notes/:id/duplicate', (c) => c.json(store.duplicateNote(c.req.param('id')), 201));
  app.post('/api/notes/merge', async (c) => {
    const b = await body(c);
    if (!Array.isArray(b.ids)) throw new ValidationError('ids must be an array');
    return c.json(store.mergeNotes(b.ids.map(String)));
  });
  app.get('/api/notes/:id/backlinks', (c) => c.json(store.backlinks(c.req.param('id'))));
  app.post('/api/notes/:id/restore', (c) => c.json(store.restoreNote(c.req.param('id'))));
  app.delete('/api/trash', (c) => c.json({ deleted: store.emptyTrash() }));

  app.get('/api/notes/:id/versions', (c) => c.json(store.listVersions(c.req.param('id'))));
  app.post('/api/notes/:id/versions/:versionId/restore', (c) =>
    c.json(store.restoreVersion(c.req.param('id'), Number(c.req.param('versionId')))),
  );

  // ---------------------------------------------------------------- templates
  app.get('/api/templates', (c) => c.json(store.listTemplates()));
  app.post('/api/templates', async (c) => {
    const b = await body(c);
    return c.json(store.saveAsTemplate(String(b.noteId ?? '')), 201);
  });
  app.post('/api/templates/:id/use', async (c) => {
    const b = await body(c).catch(() => ({}));
    return c.json(store.createFromTemplate(c.req.param('id'), typeof b.notebookId === 'string' ? b.notebookId : undefined), 201);
  });
  app.delete('/api/templates/:id', (c) => {
    store.deleteNotePermanently(c.req.param('id'));
    return c.body(null, 204);
  });

  // -------------------------------------------------------------------- tasks
  app.get('/api/tasks', (c) => {
    const q = c.req.query();
    const status = ['open', 'done', 'all'].includes(q.status ?? '') ? (q.status as 'open' | 'done' | 'all') : 'open';
    const due = ['overdue', 'today', 'week', 'none', 'any'].includes(q.due ?? '') ? (q.due as any) : undefined;
    return c.json(store.listTasks({ status, due }));
  });
  app.patch('/api/tasks/:noteId/:idx', async (c) => {
    const b = await body(c);
    const patch: { checked?: boolean; due?: string | null } = {};
    if (typeof b.checked === 'boolean') patch.checked = b.checked;
    if (b.due === null || typeof b.due === 'string') patch.due = b.due;
    store.updateTask(c.req.param('noteId'), Number(c.req.param('idx')), patch);
    return c.body(null, 204);
  });

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
    // User files are untrusted: HTML, SVG and the like never run script in our origin. PDFs are the exception, so
    // the browser's built-in viewer can show them; they are served with their exact type and nosniff.
    if (att.mime !== 'application/pdf') c.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    c.header('Content-Type', inline ? att.mime : 'application/octet-stream');
    c.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeFilename(att.filename)}"`);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    c.header('Accept-Ranges', 'bytes');

    // Byte ranges let audio and video players seek.
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
    if (range && (range[1] || range[2])) {
      const size = att.data.length;
      let start = range[1] ? Number(range[1]) : size - Math.min(Number(range[2]), size);
      let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        c.header('Content-Range', `bytes */${size}`);
        return c.body(null, 416);
      }
      start = Math.max(0, start);
      end = Math.max(start, end);
      c.header('Content-Range', `bytes ${start}-${end}/${size}`);
      return c.body(new Uint8Array(att.data.subarray(start, end + 1)), 206);
    }
    return c.body(new Uint8Array(att.data));
  });
  app.delete('/api/attachments/:id', (c) => {
    store.deleteAttachment(c.req.param('id'));
    return c.body(null, 204);
  });

  // --------------------------------------------------------------- web clipper
  app.post('/api/clip', async (c) => {
    const b = await body(c);
    const note = await clipPage(store, {
      title: typeof b.title === 'string' ? b.title : undefined,
      url: typeof b.url === 'string' ? b.url : undefined,
      html: typeof b.html === 'string' ? b.html : undefined,
      notebookId: typeof b.notebookId === 'string' ? b.notebookId : undefined,
      notebook: typeof b.notebook === 'string' ? b.notebook : undefined,
      tags: Array.isArray(b.tags) ? b.tags.map(String) : undefined,
      screenshot: typeof b.screenshot === 'string' ? b.screenshot : undefined,
      images: b.images === false ? false : true,
    }, clipOptions);
    return c.json({ id: note.id, title: note.title }, 201);
  });

  // -------------------------------------------------- search inside attachments
  app.get('/api/index/status', (c) => (indexer ? c.json(indexer.status()) : c.json({ error: 'not available' }, 404)));

  // --------------------------------------------------------------------- sync
  app.get('/api/sync/config', (c) => (sync ? c.json(sync.getConfig()) : c.json({ error: 'sync is not available' }, 404)));
  const google = options.google;
  const googleInfo = () => (google ? { configured: google.configured(), connected: google.connected(), ...google.state(), profile: google.profile() } : null);
  app.get('/api/sync/google', (c) => (google ? c.json(googleInfo()) : c.json({ error: 'not available' }, 404)));
  app.post('/api/sync/google/connect', async (c) => (google ? c.json(await google.begin()) : c.json({ error: 'not available' }, 404)));
  app.post('/api/sync/google/disconnect', async (c) => {
    if (!google) return c.json({ error: 'not available' }, 404);
    await google.disconnect();
    return c.json(googleInfo());
  });
  app.put('/api/sync/config', async (c) => {
    if (!sync) return c.json({ error: 'sync is not available' }, 404);
    const b = await body(c);
    const patch: Parameters<SyncEngine['setConfig']>[0] = {};
    if (b.folder === null || typeof b.folder === 'string') patch.folder = b.folder;
    if (b.backend === 'folder' || b.backend === 'remote') patch.backend = b.backend;
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
    if (typeof b.intervalMinutes === 'number') patch.intervalMinutes = b.intervalMinutes;
    if (b.passphrase === null || typeof b.passphrase === 'string') patch.passphrase = b.passphrase;
    if (typeof b.deviceName === 'string') patch.deviceName = b.deviceName;
    sync.setConfig(patch);
    return c.json(sync.getConfig());
  });
  app.get('/api/sync/status', (c) => (sync ? c.json(sync.getStatus()) : c.json({ error: 'sync is not available' }, 404)));
  app.post('/api/sync/run', async (c) => (sync ? c.json(await sync.run()) : c.json({ error: 'sync is not available' }, 404)));

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
  app.post('/api/import/markdown', async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const notebook = c.req.query('notebook') ?? 'Imported';
    try {
      const result = looksLikeZip(bytes)
        ? importArchive(store, bytes, notebook)
        : importFile(store, c.req.query('filename') ?? 'Imported note.md', new TextDecoder().decode(bytes), notebook);
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof Error && /archive|no Markdown/.test(err.message)) throw new ValidationError(err.message);
      throw err;
    }
  });
  app.get('/api/export/zip', (c) => {
    const notebookId = c.req.query('notebook');
    const notes = store.listNotes({ notebookId, limit: 5000 }).map((n) => store.getNote(n.id));
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', 'attachment; filename="opennote-export.zip"');
    return c.body(exportZip(store, notes) as Uint8Array<ArrayBuffer>);
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
