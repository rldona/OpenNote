/**
 * Stand-in for `node:crypto` in the browser build. The store and the ENEX importer only need hashing (synchronous, which
 * WebCrypto cannot do), random ids and random bytes; those are real. The sync engine's cipher functions are not available
 * here yet, so they throw: sync in the browser arrives with the Google Drive phase.
 */
import { md5 } from '@noble/hashes/legacy.js';
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

const unavailable = (name: string) => () => {
  throw new Error(`${name} is not available in the browser build yet`);
};
export const createCipheriv = unavailable('createCipheriv');
export const createDecipheriv = unavailable('createDecipheriv');
export const createHmac = unavailable('createHmac');
export const scryptSync = unavailable('scryptSync');
export const timingSafeEqual = unavailable('timingSafeEqual');
