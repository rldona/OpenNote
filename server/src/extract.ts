/**
 * Text of attachments, for searching inside them: plain text files directly, PDFs through Poppler's `pdftotext`,
 * and images (or scanned PDFs) through Tesseract OCR. Poppler and Tesseract are optional system tools: when they are
 * not installed those files are simply not indexed, and they are picked up automatically once the tools appear.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

export interface Tools {
  pdftotext?: string;
  pdftoppm?: string;
  tesseract?: string;
  /** Tesseract language packs to use, e.g. "eng+spa". */
  languages?: string;
}

export type Run = (file: string, args: string[], opts: { timeout: number; maxBuffer: number }) => Promise<string>;

const defaultRun: Run = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...opts, encoding: 'utf8', windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_OCR_PAGES = 10;
const MAX_INDEXED_CHARS = 500_000;
const TOOL_TIMEOUT_MS = 90_000;

const TEXT_TYPES = /^(text\/|application\/(json|xml|x-ndjson))/;
const TEXT_NAMES = /\.(txt|md|markdown|csv|tsv|json|xml|log|ini|yaml|yml|html?|rtf)$/i;
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|bmp|tiff?|webp)$/;

/** Folders GUI apps usually miss on PATH (Homebrew, Windows installers). */
const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', 'C:\\Program Files\\Tesseract-OCR', 'C:\\Program Files\\poppler\\Library\\bin', 'C:\\Program Files\\poppler\\bin'];

export function findExecutable(name: string, env = process.env): string | undefined {
  const dirs = [...(env.PATH ?? '').split(delimiter), ...EXTRA_DIRS];
  for (const dir of dirs.filter(Boolean)) {
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export async function detectTools(run: Run = defaultRun, find = findExecutable): Promise<Tools> {
  const tools: Tools = { pdftotext: find('pdftotext'), pdftoppm: find('pdftoppm'), tesseract: find('tesseract') };
  if (tools.tesseract) {
    try {
      const out = await run(tools.tesseract, ['--list-langs'], { timeout: 15_000, maxBuffer: 1 << 20 });
      const installed = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[a-z_]{3,}$/i.test(l) && l !== 'osd');
      const wanted = ['eng', 'spa'].filter((l) => installed.includes(l));
      tools.languages = (wanted.length ? wanted : installed.slice(0, 1)).join('+') || undefined;
    } catch {
      tools.tesseract = undefined;
    }
  }
  return tools;
}

export type Kind = 'text' | 'pdf' | 'image' | 'unsupported';

export function kindOf(mime: string, filename: string): Kind {
  if (mime === 'application/pdf' || /\.pdf$/i.test(filename)) return 'pdf';
  if (IMAGE_TYPES.test(mime)) return 'image';
  if (TEXT_TYPES.test(mime) || TEXT_NAMES.test(filename)) return 'text';
  return 'unsupported';
}

/** Whether we could extract text from this kind of file with the tools at hand. */
export function canExtract(kind: Kind, tools: Tools): boolean {
  if (kind === 'text') return true;
  if (kind === 'pdf') return !!tools.pdftotext;
  if (kind === 'image') return !!(tools.tesseract && tools.languages);
  return false;
}

const clean = (s: string) => s.replace(/\u0000/g, '').replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_INDEXED_CHARS);

async function ocr(tools: Tools, imagePath: string, run: Run): Promise<string> {
  return run(tools.tesseract!, [imagePath, 'stdout', '-l', tools.languages!, '--psm', '3'], { timeout: TOOL_TIMEOUT_MS, maxBuffer: 20 << 20 });
}

/** Returns the text of an attachment ('' when it has none); throws when a tool fails. */
export async function extractText(tools: Tools, mime: string, filename: string, data: Uint8Array, run: Run = defaultRun): Promise<string> {
  const kind = kindOf(mime, filename);
  if (kind === 'text') return clean(new TextDecoder('utf-8', { fatal: false }).decode(data.subarray(0, MAX_TEXT_BYTES)).replace(/<[^>]+>/g, ' '));
  if (!canExtract(kind, tools)) return '';

  const dir = await mkdtemp(join(tmpdir(), 'opennote-extract-'));
  try {
    const ext = kind === 'pdf' ? 'pdf' : (filename.split('.').pop() ?? 'img').replace(/[^\w]/g, '').slice(0, 5) || 'img';
    const file = join(dir, `input.${ext}`);
    await writeFile(file, data);
    if (kind === 'image') return clean(await ocr(tools, file, run));

    const text = clean(await run(tools.pdftotext!, ['-q', '-enc', 'UTF-8', file, '-'], { timeout: TOOL_TIMEOUT_MS, maxBuffer: 50 << 20 }));
    if (text.length >= 20 || !tools.pdftoppm || !tools.tesseract || !tools.languages) return text;
    // A scanned PDF has no text layer: render its first pages and read them.
    await run(tools.pdftoppm, ['-r', '150', '-png', '-l', String(MAX_OCR_PAGES), file, join(dir, 'page')], { timeout: TOOL_TIMEOUT_MS, maxBuffer: 1 << 20 });
    const pages = (await readdir(dir)).filter((f) => /^page.*\.png$/.test(f)).sort();
    const parts: string[] = [];
    for (const p of pages) parts.push(await ocr(tools, join(dir, p), run));
    return clean(parts.join('\n\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
