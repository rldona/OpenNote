import { canExtract, detectTools, extractText, kindOf, type Run, type Tools } from './extract.js';
import type { NoteStore } from './store.js';

export interface IndexStatus {
  /** Text of PDFs can be read (Poppler is installed). */
  pdf: boolean;
  /** Images and scanned PDFs can be read (Tesseract is installed). */
  ocr: boolean;
  languages: string | null;
  pending: number;
  indexed: number;
  failed: number;
}

/**
 * Reads attachments in the background, one at a time, and feeds their text to the full-text index so searches also
 * find words inside PDFs, images and text files. Never blocks the app and never throws into it.
 */
export class AttachmentIndexer {
  private tools: Tools = {};
  private queue: string[] = [];
  private queued = new Set<string>();
  private working: Promise<void> | null = null;

  constructor(
    private readonly store: NoteStore,
    private readonly opts: { tools?: Tools; run?: Run; log?: (m: string) => void } = {},
  ) {
    if (opts.tools) this.tools = opts.tools;
    store.onAttachmentAdded((id) => this.enqueue(id));
  }

  /** Detects the tools and queues every attachment that has not been read yet. */
  async init(): Promise<void> {
    if (!this.opts.tools) this.tools = await detectTools(this.opts.run);
    for (const a of this.store.attachmentsToIndex()) {
      if (a.status === null || canExtract(kindOf(a.mime, a.filename), this.tools)) this.enqueue(a.id);
    }
  }

  enqueue(id: string): void {
    if (this.queued.has(id)) return;
    this.queued.add(id);
    this.queue.push(id);
    this.working ??= this.drain();
  }

  private async drain(): Promise<void> {
    await Promise.resolve(); // let the caller finish its transaction first
    while (this.queue.length) {
      const id = this.queue.shift()!;
      this.queued.delete(id);
      await this.process(id);
    }
    this.working = null;
  }

  private async process(id: string): Promise<void> {
    try {
      const att = this.store.getAttachment(id);
      const kind = kindOf(att.mime, att.filename);
      if (!canExtract(kind, this.tools)) {
        // Remember we looked, so it is retried only when a tool shows up.
        this.store.setAttachmentText(id, '', kind === 'unsupported' ? 'unsupported' : 'needs-tool');
        return;
      }
      const text = await extractText(this.tools, att.mime, att.filename, att.data, this.opts.run);
      this.store.setAttachmentText(id, text, text ? 'ok' : 'empty');
    } catch (err) {
      // Deleted meanwhile, or a tool failed: record it unless the attachment is gone.
      this.opts.log?.(`attachment ${id}: ${err instanceof Error ? err.message : String(err)}`);
      try {
        this.store.setAttachmentText(id, '', 'failed');
      } catch {
        // attachment no longer exists
      }
    }
  }

  /** Resolves when the queue is empty (used by tests). */
  async idle(): Promise<void> {
    while (this.working) await this.working;
  }

  status(): IndexStatus {
    const counts = this.store.attachmentIndexCounts();
    return {
      pdf: !!this.tools.pdftotext,
      ocr: !!(this.tools.tesseract && this.tools.languages),
      languages: this.tools.languages ?? null,
      pending: this.queue.length + counts.pending,
      indexed: counts.ok,
      failed: counts.failed,
    };
  }
}
