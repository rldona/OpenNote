import type { ClipMode } from './extract';

export const DEFAULT_SERVER = 'http://localhost:3737';

export interface Notebook { id: string; name: string; stack: string | null }
export interface ClipPayload {
  title: string;
  url: string;
  html: string;
  notebookId?: string;
  tags?: string[];
  screenshot?: string;
}

/** The extension only has permission for localhost; anything else is refused up front with a clear message. */
export function normalizeServer(input: string | undefined): string {
  const raw = (input || DEFAULT_SERVER).trim().replace(/\/+$/, '');
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Only http://localhost or http://127.0.0.1 addresses are allowed');
  }
  return url.origin;
}

export async function listNotebooks(server: string): Promise<Notebook[]> {
  const res = await fetch(`${server}/api/notebooks`);
  if (!res.ok) throw new Error(`OpenNote answered ${res.status}`);
  return res.json();
}

export async function saveClip(server: string, payload: ClipPayload): Promise<{ id: string; title: string }> {
  const res = await fetch(`${server}/api/clip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `OpenNote answered ${res.status}`);
  return data as { id: string; title: string };
}

export type ExtractResult =
  | { ok: true; title: string; url: string; html: string }
  | { ok: false; error: string };

/** Reads the page of a tab through the injected content script. */
export async function extractFromTab(tabId: number, mode: ClipMode): Promise<ExtractResult> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (m: string) => (globalThis as unknown as { __opennoteExtract: (m: string) => unknown }).__opennoteExtract(m),
    args: [mode],
  });
  return (res?.result as ExtractResult | undefined) ?? { ok: false, error: 'Could not read this page (browser pages cannot be clipped)' };
}

export async function getSettings(): Promise<{ server: string; notebookId?: string }> {
  const s = (await chrome.storage.local.get(['server', 'notebookId'])) as { server?: string; notebookId?: string };
  return { server: normalizeServer(s.server), notebookId: s.notebookId };
}

export const saveSettings = (patch: { server?: string; notebookId?: string }) => chrome.storage.local.set(patch);
