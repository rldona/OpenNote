import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { isPrivateAddress } from '../src/clip.js';
import { openDb } from '../src/db.js';
import { NoteStore } from '../src/store.js';
import { NothingSelectedError, extractFromDocument } from '../../extension/src/extract.js';

const H = { host: 'localhost:3737', 'content-type': 'application/json' };
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PUBLIC = async () => ['93.184.216.34'];

function imageFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const make = routes[url];
    return make ? make() : new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}
const png = (type = 'image/png') => () => new Response(PNG, { headers: { 'content-type': type } });

function setup(fetchFn?: typeof fetch, resolve: (host: string) => Promise<string[]> = PUBLIC) {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-clip-'));
  const store = new NoteStore(openDb(':memory:'), join(dir, 'attachments'));
  return { store, app: createApp(store, undefined, { fetch: fetchFn, resolve }) };
}

const clip = (app: ReturnType<typeof createApp>, body: object, headers: Record<string, string> = {}) =>
  app.request('/api/clip', { method: 'POST', headers: { ...H, ...headers }, body: JSON.stringify(body) });

const PAGE = `<!doctype html><html><head><title>Great Post - Example Blog</title>
<meta property="og:title" content="Great Post"><meta name="description" content="A short summary of the post."></head>
<body>
<header role="banner"><nav><a href="/">Home</a><a href="/about">About</a><a href="/x">Contact</a></nav></header>
<div class="cookie-banner">We use cookies. <button>OK</button></div>
<div id="sidebar" class="sidebar"><a href="/a">Popular 1</a> <a href="/b">Popular 2</a></div>
<article>
  <h1>Great Post</h1>
  <p>The first paragraph has plenty of text so that the extractor sees real prose here, not a menu of links.</p>
  <p>Second paragraph, again long enough to count as content for the scoring function, with a <a href="/rel/link">relative link</a>.</p>
  <img data-src="/img/lazy.png" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="lazy">
  <img src="https://cdn.example.com/photo.png" srcset="a.png 1x, b.png 2x" class="hero" onload="evil()">
  <p>Third paragraph closes the article with more words to read, because scoring counts characters of prose.</p>
  <script>track()</script>
</article>
<footer>© Example</footer>
</body></html>`;

describe('page extraction (extension)', () => {
  const doc = () => parseHTML(PAGE).document as unknown as Document;
  const url = 'https://blog.example.com/posts/great';

  it('article mode keeps the prose and drops menus, banners, sidebars and scripts', () => {
    const r = extractFromDocument(doc(), url, 'article');
    expect(r.title).toBe('Great Post');
    expect(r.html).toContain('first paragraph');
    expect(r.html).toContain('Third paragraph');
    expect(r.html).not.toMatch(/Home|cookies|Popular|track\(\)|Example<|<h1/);
    expect(r.html).not.toMatch(/onload|class=|<script/);
  });

  it('makes links and images absolute and resolves lazy images', () => {
    const r = extractFromDocument(doc(), url, 'article');
    expect(r.html).toContain('href="https://blog.example.com/rel/link"');
    expect(r.html).toContain('src="https://blog.example.com/img/lazy.png"');
    expect(r.html).toContain('src="https://cdn.example.com/photo.png"');
  });

  it('page mode keeps more of the document but still no scripts or forms', () => {
    const r = extractFromDocument(doc(), url, 'page');
    expect(r.html).toContain('first paragraph');
    expect(r.html).not.toMatch(/<script|<button/);
  });

  it('selection mode uses the selected HTML and refuses an empty selection', () => {
    const r = extractFromDocument(doc(), url, 'selection', '<p>just <b>this</b> <a href="/p">part</a></p>');
    expect(r.html).toBe('<p>just <b>this</b> <a href="https://blog.example.com/p">part</a></p>');
    expect(() => extractFromDocument(doc(), url, 'selection', '  ')).toThrow(NothingSelectedError);
  });

  it('bookmark mode is a link plus the page description', () => {
    const r = extractFromDocument(doc(), url, 'bookmark');
    expect(r.html).toBe('<p><a href="https://blog.example.com/posts/great">Great Post</a></p><p>A short summary of the post.</p>');
  });

  it('falls back to the body for pages with no clear article', () => {
    const d = parseHTML('<html><head><title>T</title></head><body><p>short</p></body></html>').document as unknown as Document;
    expect(extractFromDocument(d, url, 'article').html).toContain('short');
  });
});

describe('POST /api/clip', () => {
  it('creates a note with source URL, tags, notebook and sanitized content', async () => {
    const { app, store } = setup();
    const res = await clip(app, {
      title: 'Great Post', url: 'https://blog.example.com/posts/great', notebook: 'Reading', tags: ['web/clip', 'blog'],
      html: '<p onclick="x()">hello</p><script>alert(1)</script>', images: false,
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const note = store.getNote(id);
    expect(note).toMatchObject({ title: 'Great Post', sourceUrl: 'https://blog.example.com/posts/great', tags: ['blog', 'web/clip'] });
    expect(note.content).toBe('<p>hello</p>');
    expect(store.listNotebooks().find((n) => n.id === note.notebookId)!.name).toBe('Reading');
  });

  it('downloads images as attachments and rewrites their URLs', async () => {
    const { fn, calls } = imageFetch({ 'https://cdn.example.com/photo.png': png() });
    const { app, store } = setup(fn);
    const html = '<p><img src="https://cdn.example.com/photo.png" srcset="x 1x"><img src="https://cdn.example.com/photo.png"></p>';
    const { id } = (await (await clip(app, { title: 'p', url: 'https://blog.example.com/', html })).json()) as { id: string };
    const note = store.getNote(id);
    const atts = store.listAttachments(id);
    expect(atts).toHaveLength(1); // same URL twice → one file
    expect(atts[0]).toMatchObject({ filename: 'photo.png', mime: 'image/png' });
    expect(note.content.match(new RegExp(`/api/attachments/${atts[0]!.id}`, 'g'))).toHaveLength(2);
    expect(note.content).not.toMatch(/srcset|cdn\.example\.com/);
    expect(calls).toHaveLength(1);
  });

  it('keeps remote URLs for images that fail, are not images, or are too big', async () => {
    const { fn } = imageFetch({
      'https://ok.example.com/ok.png': png(),
      'https://ex.example.com/page.png': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      'https://ex.example.com/huge.png': () => new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': String(50 * 1024 * 1024) } }),
    });
    const { app, store } = setup(fn);
    const html = '<img src="https://ok.example.com/ok.png"><img src="https://ex.example.com/page.png"><img src="https://ex.example.com/huge.png"><img src="https://ex.example.com/missing.png">';
    const { id } = (await (await clip(app, { title: 't', html })).json()) as { id: string };
    expect(store.listAttachments(id)).toHaveLength(1);
    const content = store.getNote(id).content;
    expect(content).toContain('https://ex.example.com/page.png');
    expect(content).toContain('https://ex.example.com/huge.png');
  });

  it('never fetches private, loopback or link-local addresses (SSRF), including via redirects and DNS', async () => {
    const { fn, calls } = imageFetch({
      'https://cdn.example.com/redirect.png': () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:3737/api/notes' } }),
    });
    const { app } = setup(fn, async (host) => (host === 'rebind.example.com' ? ['10.0.0.5'] : ['93.184.216.34']));
    const html = [
      'http://127.0.0.1:3737/api/notes', 'http://localhost:3737/x.png', 'http://[::1]/x.png', 'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.1/x.png', 'https://rebind.example.com/x.png', 'https://cdn.example.com/redirect.png', 'file:///etc/passwd',
    ].map((u) => `<img src="${u}">`).join('');
    expect((await clip(app, { title: 'ssrf', html })).status).toBe(201);
    expect(calls).toEqual(['https://cdn.example.com/redirect.png']); // only the public URL, and its redirect was refused
  });

  it('attaches a screenshot and rejects a bad one', async () => {
    const { app, store } = setup();
    const shot = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;
    const { id } = (await (await clip(app, { title: 's', url: 'https://x.example.com/', html: '<p>link</p>', screenshot: shot })).json()) as { id: string };
    const [att] = store.listAttachments(id);
    expect(att).toMatchObject({ filename: 'screenshot.png', mime: 'image/png' });
    expect(store.getNote(id).content.startsWith(`<p><img src="/api/attachments/${att!.id}"`)).toBe(true);
    expect((await clip(app, { title: 's', screenshot: 'data:text/html;base64,PHNjcmlwdD4=' })).status).toBe(400);
  });

  it('validates input', async () => {
    const { app } = setup();
    expect((await clip(app, { title: 'x', url: 'not a url' })).status).toBe(400);
    expect((await app.request('/api/clip', { method: 'POST', headers: H, body: '{broken' })).status).toBe(400);
    const ok = await clip(app, { html: '<p>no title</p>', url: 'javascript:alert(1)' });
    expect(ok.status).toBe(201); // non-http URLs are dropped, not stored as links
  });
});

describe('who may call the clip endpoint', () => {
  it('allows browser extension origins on /api/clip only, with CORS limited to that origin', async () => {
    const { app } = setup();
    const ext = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    const pre = await app.request('/api/clip', { method: 'OPTIONS', headers: { ...H, origin: ext } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(ext);
    const ok = await clip(app, { title: 'x', html: '<p>x</p>' }, { origin: ext });
    expect(ok.status).toBe(201);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ext);

    const other = await app.request('/api/notes', { method: 'POST', headers: { ...H, origin: ext }, body: '{}' });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('still rejects web pages and foreign hosts', async () => {
    const { app } = setup();
    expect((await clip(app, { title: 'x' }, { origin: 'https://evil.example.com' })).status).toBe(403);
    expect((await clip(app, { title: 'x' }, { origin: 'chrome-extension://evil/../x' })).status).toBe(403);
    expect((await clip(app, { title: 'x' }, { host: 'evil.example.com' })).status).toBe(403);
    expect((await app.request('/api/clip', { method: 'OPTIONS', headers: { ...H, origin: 'https://evil.example.com' } })).headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('isPrivateAddress', () => {
  it('flags non-public ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
