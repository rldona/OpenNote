/**
 * Web clipper endpoint logic: turns a page sent by the browser extension into a note,
 * downloading its images so the note keeps working offline.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { parseFragment, sanitizeHtml } from './html.js';
import type { Attachment, Note, NoteStore } from './store.js';
import { ValidationError } from './store.js';

const MAX_IMAGES = 30;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

export interface ClipInput {
  title?: string;
  url?: string;
  html?: string;
  notebookId?: string;
  notebook?: string;
  tags?: string[];
  /** data:image/png;base64,… of the visible tab. */
  screenshot?: string;
  /** Download remote images into the note (default true). */
  images?: boolean;
}

export interface ClipOptions {
  fetch?: typeof fetch;
  /** Resolves a host name to its IP addresses (injectable for tests). */
  resolve?: (host: string) => Promise<string[]>;
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

/** Loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7));
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
  }
  return true;
}

async function assertPublicHost(url: URL, resolve: NonNullable<ClipOptions['resolve']>): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('private host');
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('private host');
}

async function fetchImage(src: string, f: typeof fetch, resolve: NonNullable<ClipOptions['resolve']>): Promise<{ data: Uint8Array; mime: string } | null> {
  try {
    let url = new URL(src);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(url, resolve);
      const res = await f(url, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'image/*' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url);
        continue;
      }
      if (!res.ok) return null;
      const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(mime)) return null;
      if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return null;
      const data = new Uint8Array(await res.arrayBuffer());
      return data.length > 0 && data.length <= MAX_IMAGE_BYTES ? { data, mime } : null;
    }
  } catch {
    // unreachable, too slow or blocked: the note keeps the remote URL
  }
  return null;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp' };

function parseDataUrl(dataUrl: string): { data: Uint8Array; mime: string } {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new ValidationError('screenshot must be a base64 PNG, JPEG or WebP data URL');
  const data = Buffer.from(m[2]!, 'base64');
  if (data.length > MAX_SCREENSHOT_BYTES) throw new ValidationError('screenshot is too large');
  return { data: new Uint8Array(data), mime: m[1]! };
}

export async function clipPage(store: NoteStore, input: ClipInput, opts: ClipOptions = {}): Promise<Note> {
  const f = opts.fetch ?? fetch;
  const resolve = opts.resolve ?? defaultResolve;

  let sourceUrl: string | null = null;
  if (input.url) {
    try {
      const u = new URL(input.url);
      if (u.protocol === 'http:' || u.protocol === 'https:') sourceUrl = u.toString();
    } catch {
      throw new ValidationError('url is not valid');
    }
  }
  const title = (input.title ?? '').trim().slice(0, 500) || (sourceUrl ? new URL(sourceUrl).hostname : 'Clipped page');

  const notebookId = input.notebookId ?? (input.notebook?.trim() ? store.findOrCreateNotebook(input.notebook.trim()).id : undefined);
  const screenshot = input.screenshot ? parseDataUrl(input.screenshot) : null;

  const note = store.createNote({ notebookId, title, sourceUrl, tags: (input.tags ?? []).map(String).slice(0, 50) });
  const doc = parseFragment(sanitizeHtml(input.html ?? ''));

  const attached = new Map<string, Attachment>();
  if (input.images !== false) {
    const imgs = [...doc.querySelectorAll('img[src]')].filter((i) => /^https?:\/\//i.test(i.getAttribute('src') ?? ''));
    const unique = [...new Set(imgs.map((i) => i.getAttribute('src')!))].slice(0, MAX_IMAGES);
    const results = await Promise.all(unique.map(async (src) => [src, await fetchImage(src, f, resolve)] as const));
    for (const [src, img] of results) {
      if (!img) continue;
      const name = decodeURIComponent(new URL(src).pathname.split('/').pop() || 'image').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
      const filename = /\.\w{2,4}$/.test(name) ? name : `${name || 'image'}.${EXT[img.mime]}`;
      attached.set(src, store.addAttachment(note.id, { filename, mime: img.mime, data: img.data }));
    }
    for (const img of imgs) {
      const att = attached.get(img.getAttribute('src')!);
      if (!att) continue;
      img.setAttribute('src', `/api/attachments/${att.id}`);
      img.removeAttribute('srcset');
    }
  }

  let content = doc.body.innerHTML;
  if (screenshot) {
    const shot = store.addAttachment(note.id, { filename: `screenshot.${EXT[screenshot.mime]}`, mime: screenshot.mime, data: screenshot.data });
    content = `<p><img src="/api/attachments/${shot.id}" alt="Screenshot"></p>${content}`;
  }
  return store.updateNote(note.id, { content });
}
