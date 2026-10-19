/**
 * Starts OpenNote without a server: a worker with the database, and a service worker that answers every `/api/...` request
 * of the page (fetches, <img> tags, uploads) by asking the tab that owns the database. The UI code is unchanged.
 */
import type { ApiRequest, ApiResponse, WorkerStatus } from './protocol';

export async function bootStandalone(): Promise<void> {
  if (!('serviceWorker' in navigator) || !navigator.locks) {
    throw new Error('This browser cannot run OpenNote offline (it needs service workers and Web Locks).');
  }

  await navigator.serviceWorker.register('./standalone-sw.js');
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    // First visit: the service worker is active but does not control this page yet.
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      setTimeout(resolve, 3000);
    });
  }

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
  // status 'locked': another tab owns the database; requests from this tab are answered through it.

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
