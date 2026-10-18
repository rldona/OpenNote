// Context menu clipping: right-click → "Clip to OpenNote", using the last notebook chosen in the popup.
import { extractFromTab, getSettings, saveClip } from './api';
import type { ClipMode } from './extract';

const ITEMS: { id: ClipMode; title: string; contexts: chrome.contextMenus.ContextType[] }[] = [
  { id: 'selection', title: 'Clip selection to OpenNote', contexts: ['selection'] },
  { id: 'article', title: 'Clip article to OpenNote', contexts: ['page'] },
  { id: 'page', title: 'Clip full page to OpenNote', contexts: ['page'] },
  { id: 'bookmark', title: 'Bookmark page in OpenNote', contexts: ['page'] },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const i of ITEMS) chrome.contextMenus.create({ id: i.id, title: i.title, contexts: i.contexts });
  });
});

async function flash(tabId: number | undefined, text: string, color: string) {
  await chrome.action.setBadgeBackgroundColor({ color, tabId });
  await chrome.action.setBadgeText({ text, tabId });
  setTimeout(() => void chrome.action.setBadgeText({ text: '', tabId }), 2500);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    const page = await extractFromTab(tab.id, info.menuItemId as ClipMode);
    if (!page.ok) throw new Error(page.error);
    const { server, notebookId } = await getSettings();
    await saveClip(server, { title: page.title, url: page.url, html: page.html, notebookId });
    await flash(tab.id, '✓', '#00a82d');
  } catch {
    await flash(tab.id, '!', '#c0392b');
  }
});
