/**
 * Stand-in for `node:crypto` in the browser build: hashing, random ids and bytes (store, ENEX import) and the cipher
 * functions the sync engine uses. Everything is synchronous (WebCrypto is not), built on audited pure-JS primitives, and
 * produces the same bytes as Node's, so a folder written by the desktop app can be read in the browser and the other way
 * round (server/test/browser-parts.test.ts checks both directions).
 */
import { gcm } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { md5 } from '@noble/hashes/legacy.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';

const enc = new TextEncoder();
const toBytes = (d: Uint8Array | string) => (typeof d === 'string' ? enc.encode(d) : d);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function createHash(algorithm: string) {
  const fn = algorithm === 'md5' ? md5 : algorithm === 'sha256' ? sha256 : null;
  if (!fn) throw new Error(`hash not available in the browser build: ${algorithm}`);
  const chunks: Uint8Array[] = [];
  const hash = {
    update(data: Uint8Array | string) {
      chunks.push(toBytes(data));
      return hash;
    },
    digest(encoding: 'hex'): string {
      if (encoding !== 'hex') throw new Error('only hex digests are available in the browser build');
      const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      return hex(fn(all));
    },
  };
  return hash;
}

export const randomUUID = () => crypto.randomUUID();
export const randomBytes = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n)));

// ---- what the sync engine needs: AES-256-GCM, HMAC-SHA256, scrypt, constant-time compare. Same bytes as Node's.

const bytes = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength);
const EMPTY = Buffer.alloc(0);
const TAG_LENGTH = 16;

function gather(chunks: Uint8Array[]): Uint8Array {
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return all;
}

/** Node's streaming API shape, over one-shot GCM: `update` buffers, `final` returns everything. */
export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array) {
  if (algorithm !== 'aes-256-gcm') throw new Error(`cipher not available in the browser build: ${algorithm}`);
  const chunks: Uint8Array[] = [];
  let tag: Buffer | null = null;
  return {
    update(data: Uint8Array) {
      chunks.push(data);
      return EMPTY;
    },
    final() {
      const sealed = gcm(key, iv).encrypt(gather(chunks)); // ciphertext followed by the 16-byte tag
      tag = bytes(sealed.subarray(sealed.length - TAG_LENGTH));
      return bytes(sealed.subarray(0, sealed.length - TAG_LENGTH));
    },
    getAuthTag() {
      if (!tag) throw new Error('call final() first');
      return tag;
    },
  };
}

export function createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array) {
  if (algorithm !== 'aes-256-gcm') throw new Error(`cipher not available in the browser build: ${algorithm}`);
  const chunks: Uint8Array[] = [];
  let tag: Uint8Array | null = null;
  return {
    setAuthTag(t: Uint8Array) {
      tag = t;
    },
    update(data: Uint8Array) {
      chunks.push(data);
      return EMPTY;
    },
    final() {
      if (!tag) throw new Error('missing authentication tag');
      // Throws when the tag does not match, like Node's decipher.final().
      return bytes(gcm(key, iv).decrypt(gather([...chunks, tag])));
    },
  };
}

export function createHmac(algorithm: string, key: Uint8Array | string) {
  if (algorithm !== 'sha256') throw new Error(`hmac not available in the browser build: ${algorithm}`);
  const chunks: Uint8Array[] = [];
  const h = {
    update(data: Uint8Array | string) {
      chunks.push(toBytes(data));
      return h;
    },
    digest(encoding: 'hex'): string {
      if (encoding !== 'hex') throw new Error('only hex digests are available in the browser build');
      return hex(hmac(sha256, toBytes(key), gather(chunks)));
    },
  };
  return h;
}

export function scryptSync(password: Uint8Array | string, salt: Uint8Array, keylen: number, options: { N: number; r: number; p: number }) {
  return bytes(scrypt(toBytes(password), salt, { N: options.N, r: options.r, p: options.p, dkLen: keylen, maxmem: 2 ** 31 }));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
