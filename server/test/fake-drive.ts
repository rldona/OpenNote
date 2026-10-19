/**
 * An in-memory stand-in for the part of the Google Drive v3 API that GoogleDriveTransport uses, exposed as a `fetch`.
 * It models what matters to the transport: bearer tokens, the appDataFolder space, paginated listing, multipart and
 * resumable uploads, md5 checksums, createdTime ordering, and failures injected by the test.
 */
import { createHash } from 'node:crypto';

interface Stored { id: string; name: string; data: Buffer; createdTime: string; md5: string }

export function createFakeDrive() {
  const files = new Map<string, Stored>();
  const sessions = new Map<string, { id: string | null; name: string | null }>();
  let counter = 0;
  const calls: string[] = [];
  const state = { validToken: 'good', failNext: [] as number[], pageSize: 1000, tick: 0 };

  const meta = (f: Stored) => ({ id: f.id, name: f.name, md5Checksum: f.md5, size: String(f.data.length), createdTime: f.createdTime });
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const save = (name: string, data: Buffer, id?: string) => {
    const existing = id ? files.get(id) : undefined;
    const f: Stored = existing ?? { id: `f${++counter}`, name, data, createdTime: new Date(Date.UTC(2026, 0, 1, 0, 0, state.tick++)).toISOString(), md5: '' };
    f.data = data;
    f.md5 = createHash('md5').update(data).digest('hex');
    files.set(f.id, f);
    return f;
  };

  async function handler(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url.pathname}${url.searchParams.get('uploadType') ? `?${url.searchParams.get('uploadType')}` : ''}`);
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
    if (auth !== `Bearer ${state.validToken}`) return json({ error: { message: 'Invalid Credentials' } }, 401);
    const injected = state.failNext.shift();
    if (injected) return json({ error: { message: 'injected' } }, injected);

    const body = init.body instanceof Blob ? Buffer.from(await init.body.arrayBuffer()) : init.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
    const path = url.pathname;

    // list
    if (method === 'GET' && path === '/drive/v3/files') {
      if (url.searchParams.get('spaces') !== 'appDataFolder') return json({ error: 'wrong space' }, 400);
      const q = url.searchParams.get('q') ?? '';
      const byName = /name = '([^']+)'/.exec(q)?.[1];
      const all = [...files.values()].filter((f) => !byName || f.name === byName);
      const size = Math.min(state.pageSize, Number(url.searchParams.get('pageSize') ?? 100));
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const page = all.slice(start, start + size);
      return json({ files: page.map(meta), ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
    }
    // download / delete
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (one) {
      const f = files.get(one[1]!);
      if (!f) return json({ error: 'not found' }, 404);
      if (method === 'DELETE') {
        files.delete(f.id);
        return new Response(null, { status: 204 });
      }
      if (method === 'GET' && url.searchParams.get('alt') === 'media') return new Response(new Uint8Array(f.data));
    }
    // uploads
    if (path === '/upload/drive/v3/files' && method === 'POST' && url.searchParams.get('uploadType') === 'multipart') {
      const boundary = /boundary=(.+)$/.exec((init.headers as Record<string, string>)['Content-Type'] ?? '')![1]!;
      const text = body.toString('latin1');
      const parts = text.split(`--${boundary}`).slice(1, -1);
      const metaJson = JSON.parse(Buffer.from(parts[0]!.split('\r\n\r\n')[1]!.replace(/\r\n$/, ''), 'latin1').toString('utf8'));
      const bytesStart = text.indexOf('\r\n\r\n', text.indexOf(`--${boundary}`, 2)) + 4;
      const bytesEnd = text.lastIndexOf(`\r\n--${boundary}--`);
      if (!metaJson.parents?.includes('appDataFolder')) return json({ error: 'must live in appDataFolder' }, 400);
      return json(meta(save(metaJson.name, body.subarray(bytesStart, bytesEnd))));
    }
    const upd = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (upd && method === 'PATCH' && url.searchParams.get('uploadType') === 'media') {
      if (!files.has(upd[1]!)) return json({ error: 'not found' }, 404);
      return json(meta(save('', body, upd[1]!)));
    }
    if (url.searchParams.get('uploadType') === 'resumable' && (method === 'POST' || method === 'PATCH')) {
      const m = body.length ? JSON.parse(body.toString('utf8')) : {};
      const sid = `s${++counter}`;
      sessions.set(sid, { id: upd ? upd[1]! : null, name: m.name ?? null });
      return new Response(null, { status: 200, headers: { location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${sid}` } });
    }
    if (path === '/upload/drive/v3/files' && method === 'PUT') {
      const s = sessions.get(url.searchParams.get('upload_id') ?? '');
      if (!s) return json({ error: 'no session' }, 404);
      return json(meta(save(s.name ?? '', body, s.id ?? undefined)));
    }
    return json({ error: `unhandled ${method} ${path}` }, 400);
  }

  return { fetch: handler as typeof fetch, files, calls, state, names: () => [...files.values()].map((f) => f.name).sort() };
}
