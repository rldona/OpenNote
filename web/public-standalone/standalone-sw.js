// OpenNote (browser build) service worker.
//  1. Answers every same-origin /api/... request by asking the tab that owns the local database.
//  2. Keeps the app files so it opens offline.
const CACHE = 'opennote-shell-v3';
const API_TIMEOUT_MS = 60_000;
let ownerId = null;
let ownerWaiters = [];

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
  if (event.data && event.data.type === 'owner' && event.source) {
    ownerId = event.source.id;
    const waiting = ownerWaiters;
    ownerWaiters = [];
    for (const done of waiting) done(ownerId);
  }
});

// A service worker is stopped when idle and starts again with empty memory, so "which tab owns the database" is forgotten.
// Ask the open pages; the owner answers with an 'owner' message.
async function findOwner() {
  if (ownerId) {
    const known = await self.clients.get(ownerId);
    if (known) return known;
    ownerId = null;
  }
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!pages.length) return null;
  const answered = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2500);
    ownerWaiters.push((id) => {
      clearTimeout(timer);
      resolve(id);
    });
  });
  for (const page of pages) page.postMessage({ type: 'who-owns-db' });
  const id = await answered;
  return id ? self.clients.get(id) : null;
}

const json = (status, error) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

async function askOwner(request) {
  const owner = await findOwner();
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
      // Pages lets browsers cache index.html for 10 minutes; revalidate pages so a new version shows up on the next visit.
      const network = fetch(request.mode === 'navigate' ? new Request(request, { cache: 'no-cache' }) : request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => null);
      return cached || (await network) || new Response('Offline', { status: 503 });
    })(),
  );
});
