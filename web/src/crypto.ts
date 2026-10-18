/**
 * Password-protected notes. The note body is encrypted in the browser with AES-256-GCM (key from PBKDF2-SHA256),
 * so neither the passphrase nor the plaintext ever reaches the server, the database, the sync folder or backups.
 * The stored body is a small HTML envelope; the server only sees the ciphertext and a generic label.
 *
 * Not protected: the note title, tags, notebook, dates and attachment files.
 * If the passphrase is lost the note cannot be recovered.
 */

export const ENVELOPE_ATTR = 'data-opennote-encrypted';
const VERSION = '1';
const DEFAULT_ITERATIONS = 600_000;
const AAD = new TextEncoder().encode(`opennote:v${VERSION}`);
const LABEL = '🔒 Encrypted note';

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase, or the note was modified');
  }
}

export interface NoteCipher {
  /** Encrypts HTML with this note's key (fresh random IV every time). Returns the envelope to store. */
  encrypt(html: string): Promise<string>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface Envelope {
  iterations: number;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export function isEncryptedHtml(html: string): boolean {
  return html.includes(`${ENVELOPE_ATTR}="1"`);
}

const attr = (html: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? null;

export function parseEnvelope(html: string): Envelope | null {
  if (!isEncryptedHtml(html)) return null;
  const iter = Number(attr(html, 'data-iter'));
  const salt = attr(html, 'data-salt');
  const iv = attr(html, 'data-iv');
  const ct = attr(html, 'data-ct');
  if (!Number.isInteger(iter) || iter < 1 || iter > 10_000_000 || !salt || !iv || !ct) return null;
  try {
    return { iterations: iter, salt: fromB64(salt), iv: fromB64(iv), ciphertext: fromB64(ct) };
  } catch {
    return null;
  }
}

function buildEnvelope(e: Envelope): string {
  return (
    `<div ${ENVELOPE_ATTR}="1" data-v="${VERSION}" data-iter="${e.iterations}" data-salt="${toB64(e.salt)}" ` +
    `data-iv="${toB64(e.iv)}" data-ct="${toB64(e.ciphertext)}">${LABEL}</div>`
  );
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function cipherFor(key: CryptoKey, salt: Uint8Array, iterations: number): NoteCipher {
  return {
    async encrypt(html: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, enc.encode(html)));
      return buildEnvelope({ iterations, salt, iv, ciphertext: ct });
    },
  };
}

/** Encrypts `html`; `iterations` is only lowered by tests. */
export async function lockNote(html: string, passphrase: string, iterations = DEFAULT_ITERATIONS): Promise<{ envelope: string; cipher: NoteCipher }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, iterations);
  const cipher = cipherFor(key, salt, iterations);
  return { envelope: await cipher.encrypt(html), cipher };
}

export async function unlockNote(envelopeHtml: string, passphrase: string): Promise<{ html: string; cipher: NoteCipher }> {
  const e = parseEnvelope(envelopeHtml);
  if (!e) throw new Error('This note is not encrypted');
  const key = await deriveKey(passphrase, e.salt, e.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.iv as BufferSource, additionalData: AAD }, key, e.ciphertext as BufferSource);
    return { html: dec.decode(plain), cipher: cipherFor(key, e.salt, e.iterations) };
  } catch {
    throw new WrongPassphraseError();
  }
}
