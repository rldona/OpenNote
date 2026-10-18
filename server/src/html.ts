import { parseHTML } from 'linkedom';

const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form']);

/** Parse a complete HTML file (with <html>/<head>/<body>) or a bare fragment. */
export function parseDocument(html: string) {
  return /<(html|body)[\s>]/i.test(html) ? parseHTML(html).document : parseFragment(html);
}

/** Parse an HTML fragment into a document whose body holds the fragment. */
export function parseFragment(html: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return document;
}

/** Plain text of a note body, used for full-text search and list snippets. */
export function htmlToText(html: string): string {
  const doc = parseFragment(html);
  for (const tag of DROP_TAGS) for (const el of doc.querySelectorAll(tag)) el.remove();
  for (const br of doc.querySelectorAll('br')) br.replaceWith('\n');
  for (const el of doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,blockquote,pre')) {
    el.append('\n');
  }
  return (doc.body.textContent ?? '').replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/**
 * Remove active content from HTML coming from outside (ENEX imports, clipped pages):
 * scripts, event handlers and javascript: URLs.
 */
export function sanitizeHtml(html: string): string {
  const doc = parseFragment(html);
  for (const tag of DROP_TAGS) for (const el of doc.querySelectorAll(tag)) el.remove();
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src') && /^(javascript|vbscript):/.test(value)) {
        el.removeAttribute(attr.name);
      } else if (name === 'src' && value.startsWith('data:') && !value.startsWith('data:image/')) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}

export function snippet(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export interface TaskItem {
  idx: number;
  text: string;
  checked: boolean;
  due: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Checklist items of a note, in document order. `due` is a YYYY-MM-DD day. */
export function extractTasks(html: string): TaskItem[] {
  const doc = parseFragment(html);
  return [...doc.querySelectorAll('li[data-type="taskItem"]')].map((li, idx) => {
    const due = li.getAttribute('data-due');
    // Nested task lists would duplicate their text in the parent: only count the item's own paragraph.
    const own = [...li.children].filter((c) => !c.matches('ul,ol'));
    const text = own.map((c) => c.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
    return { idx, text, checked: li.getAttribute('data-checked') === 'true', due: due && ISO_DAY.test(due) ? due : null };
  });
}

/** Rewrites the idx-th checklist item; returns the new HTML, or null if there is no such item. */
export function patchTaskItem(html: string, idx: number, patch: { checked?: boolean; due?: string | null }): string | null {
  const doc = parseFragment(html);
  const li = doc.querySelectorAll('li[data-type="taskItem"]')[idx];
  if (!li) return null;
  if (patch.checked !== undefined) li.setAttribute('data-checked', String(patch.checked));
  if (patch.due !== undefined) {
    if (patch.due === null) li.removeAttribute('data-due');
    else li.setAttribute('data-due', patch.due);
  }
  return doc.body.innerHTML;
}
