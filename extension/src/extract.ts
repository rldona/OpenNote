/**
 * Page → clean HTML. Pure functions over a Document so they can be unit tested without a browser.
 */
export type ClipMode = 'article' | 'page' | 'selection' | 'bookmark' | 'screenshot';

export interface Extracted {
  title: string;
  url: string;
  html: string;
}

const REMOVE =
  'script,style,noscript,iframe,object,embed,form,input,button,select,textarea,nav,aside,footer,svg,canvas,video,audio,dialog,template,link,meta,[hidden],[aria-hidden="true"]';
const NOISE_CLASS = /(^|[\s_-])(ads?|advert\w*|banner|cookie\w*|consent|popup|modal|newsletter|share|sharing|social|sidebar|related|comments?|promo\w*|subscribe|breadcrumbs?|sponsor\w*)([\s_-]|$)/i;
const KEEP_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan']);
const ARTICLE_HINTS = 'article, main, [role="main"], [itemprop="articleBody"], .post-content, .entry-content, .article-body, .article-content';

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

function linkDensity(el: Element): number {
  const total = text(el).length;
  if (!total) return 1;
  let linked = 0;
  for (const a of el.querySelectorAll('a')) linked += text(a).length;
  return linked / total;
}

/** Amount of real prose in an element, discounted when it is mostly links (menus, link lists). */
function score(el: Element): number {
  let chars = 0;
  for (const p of el.querySelectorAll('p, pre, blockquote, li')) {
    const len = text(p).length;
    if (len >= 40) chars += len;
  }
  return chars * (1 - linkDensity(el));
}

function pickArticleRoot(doc: Document): Element {
  const best = (els: Element[]) => els.map((el) => [el, score(el)] as const).sort((a, b) => b[1] - a[1])[0];
  const hinted = best([...doc.querySelectorAll(ARTICLE_HINTS)]);
  if (hinted && hinted[1] >= 200) return hinted[0];
  const generic = best([...doc.querySelectorAll('div, section')]);
  if (generic && generic[1] >= 200) return generic[0];
  return doc.body;
}

function absolute(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim(), base);
    return /^(https?|mailto):$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Lazy-loaded images keep their real URL in data-* attributes or in srcset. */
function realImageSource(img: Element, base: string): string | null {
  for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-original']) {
    const v = img.getAttribute(attr);
    if (v && !v.startsWith('data:')) return absolute(v, base);
  }
  const srcset = img.getAttribute('srcset') ?? img.getAttribute('data-srcset');
  const first = srcset?.split(',')[0]?.trim().split(/\s+/)[0];
  if (first) return absolute(first, base);
  const inline = img.getAttribute('src');
  return inline && inline.startsWith('data:image/') && inline.length < 100_000 ? inline : null;
}

function clean(root: Element, base: string, title: string): string {
  const clone = root.cloneNode(true) as Element;
  for (const el of [...clone.querySelectorAll(REMOVE)]) el.remove();
  for (const el of [...clone.querySelectorAll('[class], [id]')]) {
    if (el !== clone && NOISE_CLASS.test(`${el.getAttribute('class') ?? ''} ${el.getAttribute('id') ?? ''}`) && text(el).length < 1500) el.remove();
  }
  // The note title already shows the page title.
  const h1 = clone.querySelector('h1');
  if (h1 && title && text(h1) === title.trim()) h1.remove();

  for (const img of [...clone.querySelectorAll('img')]) {
    const src = realImageSource(img, base);
    if (!src) {
      img.remove();
      continue;
    }
    img.setAttribute('src', src);
  }
  for (const a of [...clone.querySelectorAll('a[href]')]) {
    const href = absolute(a.getAttribute('href'), base);
    if (href) a.setAttribute('href', href);
    else a.removeAttribute('href');
  }
  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) if (!KEEP_ATTRS.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
  }
  return clone.innerHTML.trim();
}

function pageTitle(doc: Document): string {
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
  return (og || doc.title || '').replace(/\s+/g, ' ').trim();
}

function description(doc: Document): string {
  const meta =
    doc.querySelector('meta[name="description"]')?.getAttribute('content') ??
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
  if (meta) return meta.trim();
  const p = [...doc.querySelectorAll('p')].map(text).find((t) => t.length >= 60);
  return p ? p.slice(0, 300) : '';
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class NothingSelectedError extends Error {}

/**
 * @param selectionHtml HTML of the user's current selection (from the page's Selection API).
 */
export function extractFromDocument(doc: Document, url: string, mode: ClipMode, selectionHtml = ''): Extracted {
  const title = pageTitle(doc) || new URL(url).hostname;
  switch (mode) {
    case 'article':
      return { title, url, html: clean(pickArticleRoot(doc), url, title) };
    case 'page':
      return { title, url, html: clean(doc.body, url, title) };
    case 'selection': {
      if (!selectionHtml.trim()) throw new NothingSelectedError('Select some text on the page first');
      const holder = doc.createElement('div');
      holder.innerHTML = selectionHtml;
      return { title, url, html: clean(holder, url, '') };
    }
    case 'bookmark':
    case 'screenshot': {
      const desc = description(doc);
      const html = `<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>${desc ? `<p>${escapeHtml(desc)}</p>` : ''}`;
      return { title, url, html };
    }
  }
}
