import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import type { Attachment, Note } from './store.js';

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });

td.addRule('taskItem', {
  filter: (node) => node.nodeName === 'LI' && (node as Element).getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => {
    const checked = (node as Element).getAttribute('data-checked') === 'true';
    return `- [${checked ? 'x' : ' '}] ${content.trim()}\n`;
  },
});

td.addRule('mediaAttachment', {
  filter: ['audio', 'video'],
  replacement: (_content, node) => {
    const src = (node as Element).getAttribute('src');
    return src ? `\n\n[${node.nodeName === 'AUDIO' ? '🎙 Audio' : '🎬 Video'}](${src})\n\n` : '';
  },
});

/** Attachments are referenced as attachments/<filename> so a folder export stays portable. */
export function noteToMarkdown(
  note: Note,
  attachments: Attachment[] = [],
  attachmentName: (a: Attachment) => string = (a) => a.filename,
): string {
  const names = new Map(attachments.map((a) => [a.id, attachmentName(a)]));
  const html = note.content.replace(/\/api\/attachments\/([0-9a-f-]+)/g, (_, id: string) =>
    encodeURI(`attachments/${names.get(id) ?? id}`),
  );
  // Turndown is given a DOM node instead of a string: its browser build parses strings with DOMParser, which does not exist
  // inside a Web Worker. linkedom works the same everywhere.
  const root = parseHTML('<!doctype html><html><body></body></html>').document.createElement('div');
  root.innerHTML = html;
  const body = td.turndown(root as unknown as HTMLElement);
  const meta = [
    '---',
    `title: ${JSON.stringify(note.title || 'Untitled')}`,
    `created: ${new Date(note.createdAt).toISOString()}`,
    `updated: ${new Date(note.updatedAt).toISOString()}`,
    note.tags.length ? `tags: [${note.tags.map((t) => JSON.stringify(t)).join(', ')}]` : null,
    '---',
  ]
    .filter(Boolean)
    .join('\n');
  return `${meta}\n\n# ${note.title || 'Untitled'}\n\n${body}\n`;
}
