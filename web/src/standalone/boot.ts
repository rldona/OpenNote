/**
 * Starts OpenNote without a server: a worker with the database, and a service worker that answers every `/api/...` request
 * of the page (fetches, <img> tags, uploads) by asking the tab that owns the database. The UI code is unchanged.
 */
import { getToken } from './google-auth';
import type { ApiRequest, ApiResponse, TokenReply, TokenRequest, WorkerStatus } from './protocol';

export async function bootStandalone(): Promise<void> {
  if (!('serviceWorker' in navigator) || !navigator.locks) {
    throw new Error('This browser cannot run OpenNote offline (it needs service workers and Web Locks).');
  }

  await navigator.serviceWorker.register('./standalone-sw.js');
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    // First visit: the service worker is active but does not control this page yet. Wait for it; if it still does not,
    // reload once (a page loaded under an active service worker is controlled from the start).
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      setTimeout(resolve, 8000);
    });
    if (!navigator.serviceWorker.controller) {
      const KEY = 'opennote.sw-reload';
      let already = false;
      try {
        already = sessionStorage.getItem(KEY) === '1';
        sessionStorage.setItem(KEY, '1');
      } catch {
        /* no sessionStorage: allow one attempt */
      }
      if (!already) {
        location.reload();
        return new Promise<void>(() => {}); // the page is going away
      }
      throw new Error('The service worker did not start. Reload the page, and check that the browser allows service workers for this site.');
    }
  }
  try {
    sessionStorage.removeItem('opennote.sw-reload');
  } catch {
    /* ignore */
  }

  // Diagnostic: `await opennoteDriveRenew()` asks Google for a fresh access token as a background renewal would.
  (window as unknown as { opennoteDriveRenew: () => Promise<string> }).opennoteDriveRenew = () => getToken(true);

  const worker = new Worker(new URL('./db-worker.ts', import.meta.url), { type: 'module' });
  const status = await new Promise<WorkerStatus>((resolve) => {
    worker.addEventListener('message', function first(e: MessageEvent<WorkerStatus>) {
      if (e.data?.type === 'ready' || e.data?.type === 'locked' || e.data?.type === 'failed') {
        worker.removeEventListener('message', first);
        resolve(e.data);
      }
    });
    worker.addEventListener('error', (e) => resolve({ type: 'failed', message: e.message || 'worker failed to start' }), { once: true });
  });
  if (status.type === 'failed') throw new Error(`Could not open the local database: ${status.message}`);

  if (status.type === 'ready') {
    // This tab owns the database: answer the service worker's requests with it.
    const pending = new Map<number, MessagePort>();
    let next = 1;
    worker.addEventListener('message', (e: MessageEvent<ApiResponse>) => {
      const m = e.data;
      if (m?.type !== 'response') return;
      pending.get(m.id)?.postMessage(m, [m.body]);
      pending.delete(m.id);
    });
    worker.addEventListener('message', (e: MessageEvent<TokenRequest>) => {
      const m = e.data;
      if (m?.type !== 'token-request') return;
      void getToken(m.force).then(
        (token) => worker.postMessage({ type: 'token', id: m.id, token } satisfies TokenReply),
        (err: Error) => worker.postMessage({ type: 'token', id: m.id, error: err.message } satisfies TokenReply),
      );
    });
    const announce = () => navigator.serviceWorker.controller?.postMessage({ type: 'owner' });
    setInterval(announce, 20_000); // a restarted service worker learns who owns the database within seconds
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type: string }>) => {
      if (e.data?.type === 'who-owns-db') announce();
    });
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent<Omit<ApiRequest, 'id'> & { type: 'request' }>) => {
      const port = e.ports[0];
      if (!port || e.data?.type !== 'request') return;
      const id = next++;
      pending.set(id, port);
      const req: ApiRequest = { ...e.data, id };
      worker.postMessage(req, req.body ? [req.body] : []);
    });
    navigator.serviceWorker.controller?.postMessage({ type: 'owner' });
    // Diagnostic for this browser: `await opennoteSelfTest()` in the console runs two simulated devices through the sync
    // engine on throw-away databases (see selftest.ts).
    (window as unknown as { opennoteSelfTest: () => Promise<unknown> }).opennoteSelfTest = () =>
      new Promise((resolve) => {
        worker.addEventListener('message', function done(e: MessageEvent<{ type: string; result?: unknown }>) {
          if (e.data?.type !== 'selftest-result') return;
          worker.removeEventListener('message', done);
          resolve(e.data.result);
        });
        worker.postMessage({ type: 'selftest' });
      });
    // The controller can change (service worker update): tell the new one too.
    navigator.serviceWorker.addEventListener('controllerchange', () => navigator.serviceWorker.controller?.postMessage({ type: 'owner' }));
  }
  // status 'locked': another tab owns the database; requests from this tab are answered through it. When that tab closes,
  // the lock is released: this tab (or whichever asks first) takes over by reloading, so the others never lose their data.
  if (status.type === 'locked') {
    void navigator.locks.request('opennote-db', () => {
      location.reload();
    });
  }

  // Downloads from /api links are navigations the service worker cannot answer: fetch them and save the result.
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[download][href^="/api/"]') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    void fetch(a.getAttribute('href')!).then(async (res) => {
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      const disposition = res.headers.get('content-disposition') ?? '';
      link.href = url;
      link.download = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(disposition)?.[1] ?? a.download ?? 'download';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  });
}
