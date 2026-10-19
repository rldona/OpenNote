import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Audio } from './AudioNode';

/** Checklist item that can carry a due date, stored as data-due="YYYY-MM-DD". */
export const DueTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      due: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-due'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.due ? { 'data-due': attrs.due as string } : {}),
      },
    };
  },
});

/**
 * The note schema: what a note's HTML may contain. The web editor and the editor embedded in the mobile apps
 * (src/embed) use this same list, so a note reads and saves the same everywhere (docs/SYNC-FORMAT.md 3.2).
 */
export const noteExtensions = (placeholder = '…'): Extensions => [
  // Links are handled by each host: internal note links navigate, external ones open outside.
  StarterKit.configure({ link: { openOnClick: false } }),
  Image,
  Audio,
  Highlight,
  TaskList,
  DueTaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Placeholder.configure({ placeholder }),
];
