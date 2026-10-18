import { extractFromTab, getSettings, listNotebooks, normalizeServer, saveClip, saveSettings } from './api';
import type { ClipMode } from './extract';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  const form = $<HTMLFormElement>('form');
  const status = $('status');
  const offline = $('offline');
  const title = $<HTMLInputElement>('title');
  const notebook = $<HTMLSelectElement>('notebook');
  const tags = $<HTMLInputElement>('tags');
  const server = $<HTMLInputElement>('server');
  const save = $<HTMLButtonElement>('save');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  title.value = tab?.title ?? '';
  const settings = await getSettings().catch(() => ({ server: normalizeServer(undefined), notebookId: undefined }));
  server.value = settings.server;

  const say = (msg: string, error = false) => {
    status.textContent = msg;
    status.className = error ? 'error' : '';
  };

  try {
    const books = await listNotebooks(settings.server);
    for (const b of books) {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.stack ? `${b.stack} / ${b.name}` : b.name;
      notebook.append(opt);
    }
    if (settings.notebookId && books.some((b) => b.id === settings.notebookId)) notebook.value = settings.notebookId;
  } catch {
    offline.hidden = false;
    offline.textContent = `OpenNote is not reachable at ${settings.server}. Start it with "npm start" (or open the desktop app).`;
    save.disabled = true;
  }

  server.addEventListener('change', async () => {
    try {
      await saveSettings({ server: normalizeServer(server.value) });
      say('Address saved. Reopen the popup to reload notebooks.');
    } catch (e) {
      say((e as Error).message, true);
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!tab?.id) return say('No active tab', true);
    const mode = (form.elements.namedItem('mode') as RadioNodeList).value as ClipMode;
    save.disabled = true;
    say('Saving…');
    try {
      const page = await extractFromTab(tab.id, mode);
      if (!page.ok) throw new Error(page.error);
      const screenshot = mode === 'screenshot' ? await chrome.tabs.captureVisibleTab({ format: 'png' }) : undefined;
      const result = await saveClip(settings.server, {
        title: title.value.trim() || page.title,
        url: page.url,
        html: page.html,
        notebookId: notebook.value || undefined,
        tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean),
        screenshot,
      });
      await saveSettings({ notebookId: notebook.value });
      status.className = '';
      status.textContent = 'Saved ✓ ';
      const a = document.createElement('a');
      a.href = `${settings.server}/#/note/${result.id}`;
      a.target = '_blank';
      a.textContent = 'Open note';
      status.append(a);
    } catch (e) {
      say((e as Error).message, true);
    } finally {
      save.disabled = false;
    }
  });
}

void main();
