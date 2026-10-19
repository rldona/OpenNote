// OpenNote (browser build) service worker.
//  1. Answers every same-origin /api/... request by asking the tab that owns the local database.
//  2. Keeps the app files so it opens offline.
const CACHE = 'opennote-shell-v1';
const API_TIMEOUT_MS = 60_000;
let ownerId = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'owner' && event.source) ownerId = event.source.id;
});

const json = (status, error) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

async function askOwner(request) {
  const owner = ownerId ? await self.clients.get(ownerId) : null;
  if (!owner) return json(503, 'OpenNote is not open in any window. Reload the page.');
  const url = new URL(request.url);
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
  const { port1, port2 } = new MessageChannel();
  const reply = new Promise((resolve) => {
    port1.onmessage = (e) => resolve(e.data);
    setTimeout(() => resolve(null), API_TIMEOUT_MS);
  });
  owner.postMessage(
    { type: 'request', url: url.pathname + url.search, method: request.method, headers: [...request.headers], body },
    body ? [port2, body] : [port2],
  );
  const m = await reply;
  if (!m) return json(504, 'The local database did not answer in time.');
  const noBody = m.status === 204 || m.status === 304;
  return new Response(noBody ? null : m.body, { status: m.status, statusText: m.statusText, headers: m.headers });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(askOwner(request));
    return;
  }
  if (request.method !== 'GET') return;
  // App files: serve from cache and refresh in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => null);
      return cached || (await network) || new Response('Offline', { status: 503 });
    })(),
  );
});
