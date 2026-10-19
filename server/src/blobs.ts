/**
 * Where attachment bytes live on this device. Synchronous on purpose: the store is. On disk for the desktop app and the
 * CLI; the browser build keeps them in its own storage. (Sync copies attachments to the remote separately.)
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface BlobStore {
  put(id: string, data: Uint8Array): void;
  /** The bytes, or null when the blob does not exist. */
  get(id: string): Uint8Array | null;
  has(id: string): boolean;
  delete(id: string): void;
}

/** One file per attachment id inside a directory. */
export class FsBlobStore implements BlobStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(id: string): string {
    // Ids are UUIDs we generated; refuse anything else so an id can never point outside the directory.
    if (!/^[\w-]{1,64}$/.test(id)) throw new Error('invalid attachment id');
    return join(this.dir, id);
  }

  put(id: string, data: Uint8Array): void {
    writeFileSync(this.path(id), data);
  }

  get(id: string): Uint8Array | null {
    const p = this.path(id);
    return existsSync(p) ? readFileSync(p) : null;
  }

  has(id: string): boolean {
    return existsSync(this.path(id));
  }

  delete(id: string): void {
    rmSync(this.path(id), { force: true });
  }
}

/** Keeps blobs in memory (tests, and the reference behaviour for other implementations). */
export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Uint8Array>();

  put(id: string, data: Uint8Array): void {
    this.blobs.set(id, new Uint8Array(data));
  }

  get(id: string): Uint8Array | null {
    const b = this.blobs.get(id);
    return b ? new Uint8Array(b) : null;
  }

  has(id: string): boolean {
    return this.blobs.has(id);
  }

  delete(id: string): void {
    this.blobs.delete(id);
  }
}
