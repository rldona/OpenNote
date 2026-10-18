import { Node, mergeAttributes } from '@tiptap/react';

/** A voice recording stored as an attachment: <audio controls src="/api/attachments/ID">. */
export const Audio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'audio[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(HTMLAttributes, { controls: 'true', preload: 'metadata' })];
  },
});
