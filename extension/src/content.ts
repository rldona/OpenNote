// Injected into the page on demand. Exposes one function the popup/background call to read the page.
import { extractFromDocument, type ClipMode } from './extract';

function selectionHtml(): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
  const holder = document.createElement('div');
  for (let i = 0; i < sel.rangeCount; i++) holder.appendChild(sel.getRangeAt(i).cloneContents());
  return holder.innerHTML;
}

(globalThis as unknown as { __opennoteExtract: unknown }).__opennoteExtract = (mode: ClipMode) => {
  try {
    return { ok: true as const, ...extractFromDocument(document, location.href, mode, selectionHtml()) };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
};
