import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openTestDb } from './helpers.js';
import { findExecutable, extractText, kindOf, type Run, type Tools } from '../src/extract.js';
import { AttachmentIndexer } from '../src/indexer.js';
import { NoteStore } from '../src/store.js';

const bytes = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function setup(tools: Tools, run?: Run) {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-idx-'));
  const store = new NoteStore(openTestDb(), join(dir, 'attachments'));
  const indexer = new AttachmentIndexer(store, { tools, run });
  return { store, indexer };
}

/** Pretends to be pdftotext / pdftoppm / tesseract. */
const fakeRun: Run = async (file, args) => {
  if (file === 'pdftotext') return 'Quarterly contract between the parties\n';
  if (file === 'pdftoppm') {
    const prefix = args[args.length - 1]!;
    writeFileSync(`${prefix}-1.png`, PNG);
    writeFileSync(`${prefix}-2.png`, PNG);
    return '';
  }
  if (file === 'tesseract') return `scanned words from ${args[0]!.split(/[\\/]/).pop()}`;
  throw new Error(`unexpected tool ${file}`);
};

describe('searching inside attachments', () => {
  it('reads plain text files without any external tool', async () => {
    const { store, indexer } = setup({});
    const n = store.createNote({ title: 'notes' });
    store.addAttachment(n.id, { filename: 'todo.txt', mime: 'text/plain', data: bytes('remember the zeppelin tickets') });
    await indexer.idle();
    expect(store.listNotes({ q: 'zeppelin' }).map((x) => x.id)).toEqual([n.id]);
    // the note's own snippet is unchanged: file text only feeds the search index
    expect(store.listNotes({ q: 'zeppelin' })[0]!.snippet).toBe('');
  });

  it('indexes PDFs and images through the tools, and scanned PDFs through OCR', async () => {
    const { store, indexer } = setup({ pdftotext: 'pdftotext', pdftoppm: 'pdftoppm', tesseract: 'tesseract', languages: 'eng' }, fakeRun);
    const a = store.createNote({ title: 'a' });
    store.addAttachment(a.id, { filename: 'c.pdf', mime: 'application/pdf', data: PNG });
    const b = store.createNote({ title: 'b' });
    store.addAttachment(b.id, { filename: 'receipt.png', mime: 'image/png', data: PNG });
    await indexer.idle();
    expect(store.listNotes({ q: 'contract' }).map((x) => x.id)).toEqual([a.id]);
    expect(store.listNotes({ q: 'scanned words' }).map((x) => x.id)).toEqual([b.id]);
    expect(indexer.status()).toMatchObject({ pdf: true, ocr: true, languages: 'eng', pending: 0, indexed: 2, failed: 0 });
  });

  it('falls back to OCR for a PDF with no text layer', async () => {
    const run: Run = (file, args, opts) => (file === 'pdftotext' ? Promise.resolve('') : fakeRun(file, args, opts));
    const { store, indexer } = setup({ pdftotext: 'pdftotext', pdftoppm: 'pdftoppm', tesseract: 'tesseract', languages: 'eng' }, run);
    const n = store.createNote({ title: 'scan' });
    store.addAttachment(n.id, { filename: 'scan.pdf', mime: 'application/pdf', data: PNG });
    await indexer.idle();
    expect(store.listNotes({ q: 'page-1.png' }).map((x) => x.id)).toEqual([n.id]);
    expect(store.listNotes({ q: 'page-2.png' })).toHaveLength(1);
  });

  it('waits for a missing tool and picks the file up when it appears', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opennote-idx-'));
    const store = new NoteStore(openTestDb(), join(dir, 'attachments'));
    const n = store.createNote({ title: 'pic' });
    const first = new AttachmentIndexer(store, { tools: {}, run: fakeRun });
    store.addAttachment(n.id, { filename: 'p.png', mime: 'image/png', data: PNG });
    await first.idle();
    expect(store.attachmentsToIndex()).toEqual([expect.objectContaining({ status: 'needs-tool' })]);
    expect(first.status()).toMatchObject({ ocr: false, pending: 0 });

    const second = new AttachmentIndexer(store, { tools: { tesseract: 'tesseract', languages: 'eng+spa' }, run: fakeRun });
    await second.init();
    await second.idle();
    expect(store.listNotes({ q: 'scanned' }).map((x) => x.id)).toEqual([n.id]);
  });

  it('survives a failing tool and keeps going', async () => {
    const run: Run = async (file, args, opts) => {
      if (file === 'tesseract' && readFileSync(args[0]!, 'utf8') === 'BAD') throw new Error('boom'); // the attachment's bytes decide
      return fakeRun(file, args, opts);
    };
    const { store, indexer } = setup({ tesseract: 'tesseract', languages: 'eng' }, run);
    const n = store.createNote({ title: 'x' });
    store.addAttachment(n.id, { filename: 'bad.png', mime: 'image/png', data: bytes('BAD') });
    store.addAttachment(n.id, { filename: 'good.png', mime: 'image/png', data: PNG });
    await indexer.idle();
    expect(indexer.status()).toMatchObject({ failed: 1, indexed: 1, pending: 0 });
    expect(store.listNotes({ q: 'scanned' })).toHaveLength(1);
  });

  it('forgets the text when the attachment or the note is deleted', async () => {
    const { store, indexer } = setup({});
    const n = store.createNote({ title: 'x' });
    const att = store.addAttachment(n.id, { filename: 'a.txt', mime: 'text/plain', data: bytes('uniqueterm') });
    await indexer.idle();
    expect(store.listNotes({ q: 'uniqueterm' })).toHaveLength(1);
    store.deleteAttachment(att.id);
    expect(store.listNotes({ q: 'uniqueterm' })).toHaveLength(0);
    const att2 = store.addAttachment(n.id, { filename: 'b.txt', mime: 'text/plain', data: bytes('secondterm') });
    await indexer.idle();
    store.deleteNotePermanently(n.id);
    expect(store.listNotes({ q: 'secondterm' })).toHaveLength(0);
    expect(() => store.getAttachment(att2.id)).toThrow();
  });

  it('indexes attachments that arrive through sync', async () => {
    const { store, indexer } = setup({});
    store.applyFromSync(
      {
        id: '11111111-1111-4111-8111-111111111111', notebook: { name: 'Notes', stack: null }, title: 'synced', content: '<p>x</p>', pinned: false,
        trashedAt: null, reminderAt: null, sourceUrl: null, createdAt: 1, updatedAt: 1, isTemplate: false, tags: [],
        attachments: [{ id: '22222222-2222-4222-8222-222222222222', filename: 'n.txt', mime: 'text/plain', size: 5, md5: '0', sha256: '0', createdAt: 1 }],
      },
      new Map([['22222222-2222-4222-8222-222222222222', Buffer.from('syncedword')]]),
    );
    await indexer.idle();
    expect(store.listNotes({ q: 'syncedword' })).toHaveLength(1);
  });

  it('classifies files and exposes the status over the API', async () => {
    expect(kindOf('application/pdf', 'x')).toBe('pdf');
    expect(kindOf('application/octet-stream', 'REPORT.PDF')).toBe('pdf');
    expect(kindOf('image/png', 'a.png')).toBe('image');
    expect(kindOf('application/octet-stream', 'log.txt')).toBe('text');
    expect(kindOf('audio/webm', 'a.webm')).toBe('unsupported');
    const dir = mkdtempSync(join(tmpdir(), 'opennote-idx-'));
    const store = new NoteStore(openTestDb(), join(dir, 'attachments'));
    const app = createApp(store, undefined, undefined, new AttachmentIndexer(store, { tools: { pdftotext: 'x' } }));
    const res = await app.request('/api/index/status', { headers: { host: 'localhost:3737' } });
    expect(await res.json()).toMatchObject({ pdf: true, ocr: false, pending: 0 });
  });
});

describe.skipIf(!findExecutable('pdftotext'))('with the real pdftotext', () => {
  it('reads the text layer of a PDF', async () => {
    const stream = 'BT /F1 18 Tf 10 50 Td (Quarterly invoice 98765) Tj ET';
    const pdf = [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
      `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
      'trailer<</Root 1 0 R/Size 6>>',
      '%%EOF',
    ].join('\n');
    const text = await extractText({ pdftotext: findExecutable('pdftotext') }, 'application/pdf', 'invoice.pdf', bytes(pdf));
    expect(text).toContain('Quarterly invoice 98765');
  });
});
