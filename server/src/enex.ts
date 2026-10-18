/**
 * ENEX import/export. ENEX is Evernote's documented XML export format
 * (https://dev.evernote.com/doc/articles/enml.php), which lets people move
 * their existing notes in and out of OpenNote.
 */
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { parseFragment, sanitizeHtml } from './html.js';
import type { Attachment, Note, NoteStore } from './store.js';

const ATTACHMENT_URL = '/api/attachments/';

// ------------------------------------------------------------------ ENML → HTML

type Doc = ReturnType<typeof parseFragment>;

const BLOCK_TAGS = new Set([
  'p', 'div', 'ul', 'ol', 'li', 'table', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
]);

function retag(doc: Doc, el: Element, tag: string): Element {
  const next = doc.createElement(tag);
  while (el.firstChild) next.appendChild(el.firstChild);
  el.replaceWith(next);
  return next;
}

/** Convert ENML (Evernote's XHTML dialect) to the HTML used by the editor. */
export function enmlToHtml(enml: string, mediaByHash: Map<string, Attachment>): string {
  // The HTML parser ignores `/>` on unknown elements, so `<en-todo/>` would swallow the
  // text that follows it. Expand ENML's empty elements before parsing.
  const body = enml
    .replace(/<\?xml[^>]*\?>/i, '')
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<(en-todo|en-media)\b([^>]*?)\s*\/>/gi, '<$1$2></$1>');
  const doc = parseFragment(body);
  const root = doc.querySelector('en-note') ?? doc.body;

  for (const media of root.querySelectorAll('en-media')) {
    const att = mediaByHash.get((media.getAttribute('hash') ?? '').toLowerCase());
    const type = media.getAttribute('type') ?? '';
    if (!att) {
      media.remove();
    } else if (type.startsWith('image/')) {
      const img = doc.createElement('img');
      img.setAttribute('src', ATTACHMENT_URL + att.id);
      img.setAttribute('alt', att.filename);
      media.replaceWith(img);
    } else {
      const a = doc.createElement('a');
      a.setAttribute('href', ATTACHMENT_URL + att.id);
      a.setAttribute('download', att.filename);
      a.textContent = att.filename;
      media.replaceWith(a);
    }
  }

  for (const crypt of root.querySelectorAll('en-crypt')) crypt.replaceWith('[encrypted text]');

  // <div><en-todo/>text</div> runs become task lists.
  for (const todo of root.querySelectorAll('en-todo')) {
    const checked = todo.getAttribute('checked') === 'true';
    const parent = todo.parentElement;
    if (!parent || (parent.tagName !== 'DIV' && parent.tagName !== 'P') || parent === root) {
      todo.replaceWith(checked ? '☑ ' : '☐ ');
      continue;
    }
    todo.remove();
    const prev = parent.previousElementSibling;
    let list: Element;
    if (prev && prev.getAttribute('data-type') === 'taskList' && prev.getAttribute('data-from-enml') === '1') {
      list = prev;
    } else {
      list = doc.createElement('ul');
      list.setAttribute('data-type', 'taskList');
      list.setAttribute('data-from-enml', '1');
      parent.before(list);
    }
    const li = doc.createElement('li');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', String(checked));
    const p = doc.createElement('p');
    while (parent.firstChild) p.appendChild(parent.firstChild);
    li.appendChild(p);
    list.appendChild(li);
    parent.remove();
  }
  for (const list of root.querySelectorAll('ul[data-from-enml]')) list.removeAttribute('data-from-enml');

  // Plain text-only divs are paragraphs in the editor model.
  for (const div of [...root.querySelectorAll('div')]) {
    const hasBlock = [...div.children].some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()));
    if (!hasBlock) retag(doc, div, 'p');
  }

  return sanitizeHtml(root.innerHTML);
}

// ------------------------------------------------------------------ HTML → ENML

const ENML_TAGS = new Set([
  'a', 'abbr', 'b', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'div', 'dd', 'del', 'dl', 'dt',
  'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'ol', 'p', 'pre', 'q', 's',
  'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img']);
const ENML_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'align']);

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const stripControl = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function attachmentIdFromUrl(url: string | null): string | null {
  return url?.startsWith(ATTACHMENT_URL) ? url.slice(ATTACHMENT_URL.length) : null;
}

export function htmlToEnml(html: string, attachments: Attachment[]): string {
  const byId = new Map(attachments.map((a) => [a.id, a]));
  const doc = parseFragment(html);

  const walk = (node: Node): string => {
    if (node.nodeType === 3) return escapeXml(stripControl(node.textContent ?? ''));
    if (node.nodeType !== 1) return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const children = () => [...el.childNodes].map(walk).join('');

    if (tag === 'ul' && el.getAttribute('data-type') === 'taskList') {
      return [...el.children]
        .map((li) => {
          const checked = li.getAttribute('data-checked') === 'true';
          const inner = [...li.childNodes]
            .filter((n) => !(n.nodeType === 1 && ['LABEL', 'INPUT'].includes((n as Element).tagName)))
            .map((n) => walk(n))
            .join('')
            .replace(/<\/?(p|div)>/g, '');
          return `<div><en-todo checked="${checked}"/>${inner}</div>`;
        })
        .join('');
    }

    const attId = attachmentIdFromUrl(el.getAttribute(tag === 'a' ? 'href' : 'src'));
    const att = attId ? byId.get(attId) : undefined;
    if ((tag === 'img' || tag === 'a' || tag === 'audio' || tag === 'video') && att) {
      return `<en-media type="${escapeXml(att.mime)}" hash="${att.md5}"/>`;
    }
    if (tag === 'img' && !/^https?:/i.test(el.getAttribute('src') ?? '')) return '';

    const out = tag === 'mark' ? 'span' : tag;
    if (!ENML_TAGS.has(out)) return children();
    const attrs = [...el.attributes]
      .filter((a) => ENML_ATTRS.has(a.name.toLowerCase()))
      .map((a) => ` ${a.name.toLowerCase()}="${escapeXml(a.value)}"`)
      .join('');
    if (VOID_TAGS.has(out)) return `<${out}${attrs}/>`;
    return `<${out}${attrs}>${children()}</${out}>`;
  };

  const inner = [...doc.body.childNodes].map(walk).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
    '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">' +
    `<en-note>${inner}</en-note>`
  );
}

// -------------------------------------------------------------------- dates

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

export function toEnexDate(ms: number): string {
  const d = new Date(ms);
  return (
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function fromEnexDate(s: unknown): number | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s ?? '').trim());
  if (!m) return undefined;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
}

// ------------------------------------------------------------------- import

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (name) => name === 'note' || name === 'resource' || name === 'tag',
});

export interface ImportResult {
  notebookId: string;
  notes: number;
  attachments: number;
}

export function importEnex(store: NoteStore, xml: string, notebookName: string): ImportResult {
  const parsed = parser.parse(xml);
  const notes: any[] = parsed?.['en-export']?.note ?? [];
  if (!parsed?.['en-export']) throw new Error('not a valid ENEX file');
  const notebook = store.findOrCreateNotebook(notebookName || 'Imported');
  let attachmentCount = 0;

  for (const n of notes) {
    const title = String(n.title ?? '').trim();
    const created = fromEnexDate(n.created);
    const updated = fromEnexDate(n.updated) ?? created;
    const note = store.createNote({
      notebookId: notebook.id,
      tags: (n.tag ?? []).map(String),
      createdAt: created,
      updatedAt: updated,
    });

    const media = new Map<string, Attachment>();
    for (const r of n.resource ?? []) {
      const b64 = typeof r.data === 'object' ? r.data['#text'] : r.data;
      if (!b64) continue;
      const data = Buffer.from(String(b64), 'base64');
      const att = store.addAttachment(note.id, {
        filename: String(r['resource-attributes']?.['file-name'] ?? 'attachment'),
        mime: String(r.mime ?? 'application/octet-stream'),
        data,
      });
      // ENEX hashes are the MD5 of the bytes, which addAttachment computes the same way.
      media.set(createHash('md5').update(data).digest('hex'), att);
      attachmentCount++;
    }

    const attrs = n['note-attributes'] ?? {};
    store.updateNote(note.id, {
      title,
      content: enmlToHtml(String(n.content ?? ''), media),
      sourceUrl: attrs['source-url'] ? String(attrs['source-url']) : null,
      reminderAt: fromEnexDate(attrs['reminder-time']) ?? null,
      updatedAt: updated ?? Date.now(),
    });
  }
  return { notebookId: notebook.id, notes: notes.length, attachments: attachmentCount };
}

// ------------------------------------------------------------------- export

export function exportEnex(store: NoteStore, notes: Note[]): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">',
    `<en-export export-date="${toEnexDate(Date.now())}" application="OpenNote" version="0.1">`,
  ];
  for (const note of notes) {
    const atts = store.listAttachments(note.id);
    parts.push('<note>');
    parts.push(`<title>${escapeXml(stripControl(note.title || 'Untitled'))}</title>`);
    parts.push(`<content><![CDATA[${htmlToEnml(note.content, atts)}]]></content>`);
    parts.push(`<created>${toEnexDate(note.createdAt)}</created>`);
    parts.push(`<updated>${toEnexDate(note.updatedAt)}</updated>`);
    for (const tag of note.tags) parts.push(`<tag>${escapeXml(tag)}</tag>`);
    parts.push('<note-attributes>');
    if (note.sourceUrl) parts.push(`<source-url>${escapeXml(note.sourceUrl)}</source-url>`);
    if (note.reminderAt) parts.push(`<reminder-time>${toEnexDate(note.reminderAt)}</reminder-time>`);
    parts.push('</note-attributes>');
    for (const a of atts) {
      const { data } = store.getAttachment(a.id);
      parts.push(
        '<resource>',
        `<data encoding="base64">${data.toString('base64')}</data>`,
        `<mime>${escapeXml(a.mime)}</mime>`,
        `<resource-attributes><file-name>${escapeXml(a.filename)}</file-name></resource-attributes>`,
        '</resource>',
      );
    }
    parts.push('</note>');
  }
  parts.push('</en-export>');
  return parts.join('\n');
}
