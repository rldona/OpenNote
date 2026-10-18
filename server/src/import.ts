/**
 * Markdown / HTML import (single files, folders or Obsidian-style vaults as .zip) and
 * zip export with attachments. Folders become notebooks; a second folder level becomes a stack.
 */
import { marked } from 'marked';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { parseDocument, parseFragment, sanitizeHtml } from './html.js';
import { noteToMarkdown } from './markdown.js';
import type { Attachment, Note, NoteStore } from './store.js';

const MAX_ENTRIES = 20_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
};
const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export interface ImportSummary {
  notes: number;
  attachments: number;
  notebooks: string[];
}

// ------------------------------------------------------------------ front matter

interface Meta {
  title?: string;
  tags: string[];
  created?: number;
  updated?: number;
}

function parseFrontMatter(text: string): { meta: Meta; body: string } {
  const meta: Meta = { tags: [] };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta, body: text };
  const lines = m[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const raw = kv[2]!.trim();
    const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, '');
    if (key === 'title') meta.title = unquote(raw);
    else if (key === 'tags' || key === 'tag') {
      if (raw.startsWith('[')) meta.tags.push(...raw.slice(1, -1).split(',').map(unquote));
      else if (raw) meta.tags.push(...raw.split(',').map(unquote));
      else while (/^\s*-\s+/.test(lines[i + 1] ?? '')) meta.tags.push(unquote(lines[++i]!.replace(/^\s*-\s+/, '')));
    } else if (key === 'created' || key === 'date') {
      const t = Date.parse(unquote(raw));
      if (!Number.isNaN(t)) meta.created = t;
    } else if (key === 'updated' || key === 'modified') {
      const t = Date.parse(unquote(raw));
      if (!Number.isNaN(t)) meta.updated = t;
    }
  }
  meta.tags = meta.tags.map((t) => t.replace(/^#/, '')).filter(Boolean);
  return { meta, body: text.slice(m[0].length) };
}

// ------------------------------------------------------------- markdown → HTML

const isBox = (el: Element | null | undefined) =>
  !!el && el.tagName === 'INPUT' && el.getAttribute('type') === 'checkbox';

/** GFM task lists → the editor's taskList/taskItem markup. */
function convertTaskLists(html: string): string {
  const doc = parseFragment(html);
  for (const li of [...doc.querySelectorAll('li')]) {
    const first = li.firstElementChild;
    const box = isBox(first) ? first : isBox(first?.firstElementChild) ? first!.firstElementChild : null;
    if (!box) continue;
    const checked = box.hasAttribute('checked');
    box.remove();
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', String(checked));
    if (li.firstElementChild?.tagName !== 'P') {
      const p = doc.createElement('p');
      for (const n of [...li.childNodes]) if (!(n.nodeType === 1 && /^(UL|OL)$/.test((n as Element).tagName))) p.appendChild(n);
      li.insertBefore(p, li.firstChild);
    }
    // marked leaves a space after the removed checkbox.
    const lead = li.firstElementChild?.firstChild;
    if (lead?.nodeType === 3) lead.textContent = (lead.textContent ?? '').replace(/^\s+/, '');
  }
  // A list mixing tasks and plain bullets becomes consecutive homogeneous lists.
  for (const ul of [...doc.querySelectorAll('ul')]) {
    const isTask = (c: Element) => c.getAttribute('data-type') === 'taskItem';
    const items = [...ul.children];
    if (!items.some(isTask)) continue;
    const runs: Element[][] = [];
    for (const item of items) {
      const last = runs[runs.length - 1];
      if (last && isTask(last[0]!) === isTask(item)) last.push(item);
      else runs.push([item]);
    }
    for (const run of runs) {
      const list = doc.createElement('ul');
      if (isTask(run[0]!)) list.setAttribute('data-type', 'taskList');
      run.forEach((li) => list.appendChild(li));
      ul.before(list);
    }
    ul.remove();
  }
  return doc.body.innerHTML;
}

export function markdownToHtml(md: string): string {
  return convertTaskLists(sanitizeHtml(marked.parse(md, { async: false, gfm: true }) as string));
}

// --------------------------------------------------------------------- notes

type Asset = { name: string; data: Uint8Array };

interface FileInput {
  /** File name without directories, e.g. "Trip.md". */
  filename: string;
  text: string;
  /** Directory of the note inside the archive ('' for the root). */
  dir: string;
  notebook: string;
  stack: string | null;
}

/** Normalises ../ and ./ segments of an archive path. */
function resolvePath(dir: string, href: string): string {
  const parts = (dir ? dir.split('/') : []).concat(decodeURI(href.split(/[?#]/)[0]!).split('/'));
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

function importOne(
  store: NoteStore,
  f: FileInput,
  assets: Map<string, Asset>,
  summary: ImportSummary,
): void {
  const isHtml = /\.html?$/i.test(f.filename);
  let title = f.filename.replace(/\.[^.]+$/, '');
  let meta: Meta = { tags: [] };
  let html: string;

  if (isHtml) {
    const doc = parseDocument(f.text);
    const t = doc.querySelector('title')?.textContent?.trim();
    if (t) title = t;
    html = sanitizeHtml(doc.body?.innerHTML ?? f.text);
  } else {
    const parsed = parseFrontMatter(f.text);
    meta = parsed.meta;
    let body = parsed.body;
    // A leading "# Heading" is the note title, not body content.
    const h1 = /^\s*#\s+(.+?)\s*\r?\n/.exec(body);
    if (h1) {
      title = meta.title ?? h1[1]!.trim();
      body = body.slice(h1[0].length);
    }
    html = markdownToHtml(body);
  }
  title = meta.title ?? title;

  const notebook = store.findOrCreateNotebook(f.notebook, f.stack);
  if (!summary.notebooks.includes(notebook.name)) summary.notebooks.push(notebook.name);
  const note = store.createNote({ notebookId: notebook.id, tags: meta.tags, createdAt: meta.created, updatedAt: meta.updated ?? meta.created });

  // Relative images and links that point at files inside the archive become attachments.
  const doc = parseFragment(html);
  const added = new Map<string, Attachment>();
  for (const el of doc.querySelectorAll('img[src], a[href]')) {
    const attr = el.tagName === 'IMG' ? 'src' : 'href';
    const ref = el.getAttribute(attr) ?? '';
    if (!ref || /^([a-z][a-z0-9+.-]*:|#|\/)/i.test(ref)) continue;
    const key = resolvePath(f.dir, ref);
    const asset = assets.get(key);
    if (!asset) continue;
    let att = added.get(key);
    if (!att) {
      att = store.addAttachment(note.id, { filename: asset.name, mime: mimeOf(asset.name), data: asset.data });
      added.set(key, att);
      summary.attachments++;
    }
    el.setAttribute(attr, `/api/attachments/${att.id}`);
  }
  store.updateNote(note.id, {
    title,
    content: doc.body.innerHTML,
    updatedAt: meta.updated ?? meta.created ?? Date.now(),
  });
  summary.notes++;
}

const NOTE_FILE = /\.(md|markdown|html?)$/i;

export function importFile(store: NoteStore, filename: string, text: string, notebook: string): ImportSummary {
  const summary: ImportSummary = { notes: 0, attachments: 0, notebooks: [] };
  importOne(store, { filename, text, dir: '', notebook, stack: null }, new Map(), summary);
  return summary;
}

export function importArchive(store: NoteStore, bytes: Uint8Array, defaultNotebook: string): ImportSummary {
  let entries = 0;
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (file.name.endsWith('/') || /(^|\/)(__MACOSX|\.git|\.obsidian|node_modules)\//.test(file.name)) return false;
      if (++entries > MAX_ENTRIES) throw new Error('archive has too many files');
      total += file.originalSize;
      if (total > MAX_TOTAL_BYTES || file.originalSize > MAX_FILE_BYTES) throw new Error('archive is too large');
      return true;
    },
  });

  const assets = new Map<string, Asset>();
  const notes: [string, Uint8Array][] = [];
  for (const [path, data] of Object.entries(files)) {
    if (NOTE_FILE.test(path)) notes.push([path, data]);
    else assets.set(path, { name: path.split('/').pop()!, data });
  }
  if (!notes.length) throw new Error('no Markdown or HTML files found in the archive');

  const summary: ImportSummary = { notes: 0, attachments: 0, notebooks: [] };
  for (const [path, data] of notes.sort(([a], [b]) => a.localeCompare(b))) {
    const parts = path.split('/');
    const filename = parts.pop()!;
    // Depth 0 → default notebook, 1 → notebook, 2+ → stack/notebook.
    const dirs = parts.filter((d) => d.toLowerCase() !== 'attachments');
    const notebook = dirs.length === 0 ? defaultNotebook : dirs.length === 1 ? dirs[0]! : dirs.slice(1).join(' / ');
    const stack = dirs.length >= 2 ? dirs[0]! : null;
    importOne(store, { filename, text: strFromU8(data), dir: parts.join('/'), notebook, stack }, assets, summary);
  }
  return summary;
}

export const looksLikeZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;

// -------------------------------------------------------------------- export

const safeName = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 100) || 'Untitled';

/** One folder per notebook (Stack/Notebook), one .md per note, files in <notebook>/attachments. */
export function exportZip(store: NoteStore, notes: Note[]): Uint8Array {
  const notebooks = new Map(store.listNotebooks().map((n) => [n.id, n]));
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const enc = new TextEncoder();

  for (const note of notes) {
    const nb = notebooks.get(note.notebookId);
    const folder = [nb?.stack, nb?.name ?? 'Notes'].filter(Boolean).map((p) => safeName(p!)).join('/');
    let base = `${folder}/${safeName(note.title || 'Untitled')}`;
    for (let i = 2; used.has(`${base}.md`.toLowerCase()); i++) base = `${folder}/${safeName(note.title || 'Untitled')} (${i})`;
    used.add(`${base}.md`.toLowerCase());

    const atts = store.listAttachments(note.id);
    const rel = (a: Attachment) => `${a.id.slice(0, 8)}-${safeName(a.filename)}`;
    for (const a of atts) files[`${folder}/attachments/${rel(a)}`] = new Uint8Array(store.getAttachment(a.id).data);
    // Links in the .md are relative to the note: attachments/<name>
    files[`${base}.md`] = enc.encode(noteToMarkdown(note, atts, (a) => rel(a)));
  }
  return zipSync(files, { level: 6 });
}
