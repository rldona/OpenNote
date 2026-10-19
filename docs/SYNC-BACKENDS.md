# Sync destinations: roadmap and design

Goal: an **optional** sync you can switch on per user, so the same notes show up on every device (desktop, phone,
tablet, Android) with **no server of ours and no cost** to the project or the user. The first cloud destination is
**Google Drive** with the user's own Google account. Sync stays off until the user turns it on.

This builds on the folder sync described in [SYNC.md](SYNC.md) (version vectors, one file per note per device,
conflict copies, tombstones, optional AES-256-GCM). That logic is storage-agnostic; what changes is where the files go.

## Layers

```
 UI (React)  →  app (Hono API)  →  NoteStore (SQL)          ← where notes live on a device
                                      ↑
                              SyncEngine (merge rules, codec)
                                      ↓
                              SyncTransport                  ← where synced files live
        FolderTransport · MemoryTransport · GoogleDriveTransport · (WebDAV, S3 later)
```

`SyncTransport` (`server/src/sync-transport.ts`) is five operations over relative paths: `list`, `read`, `write`
(atomic replace), `writeIfAbsent`, `remove`, plus `exists`. Each `list` entry carries a `version` token (mtime+size,
ETag, md5…) so the engine skips files it has already parsed. A shared contract test runs against every implementation.

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 0 | Transport interface; folder sync on top of it; in-memory transport and contract tests | **done** |
| 1a | **SQL driver and attachment storage abstracted** under `NoteStore`; the whole server test suite also runs on sqlite-wasm | **done** |
| 1b | Run OpenNote **without a local server**: the rest of the portable core in the browser (see below) | next |
| 2 | `GoogleDriveTransport` + "Sign in with Google" | |
| 3 | Settings UI: add / remove sync destinations; per-destination passphrase; desktop uses the same transport | |
| 4 | Android: installable PWA first; a Capacitor shell only if the PWA falls short | |
| 5 | More destinations: WebDAV (Nextcloud…), S3-compatible | |

### Phase 1a (done): two seams under the store

- `SqlDatabase` (`server/src/sql.ts`): `exec` / `prepare().run|get|all` / `close`, positional parameters, plain-object rows.
  Node's `DatabaseSync` satisfies it unchanged; `server/src/sql-wasm.ts` adapts sqlite-wasm.
- `BlobStore` (`server/src/blobs.ts`): attachment bytes. `FsBlobStore` (files, as before) and `MemoryBlobStore`.
- `schema.ts` holds the schema and migrations without Node imports; `db.ts` is only the Node opener.
- **`npm test` now runs the full suite twice: on `node:sqlite` and on sqlite-wasm** (`OPENNOTE_TEST_DRIVER=wasm`). Both pass
  all tests, so the store, the HTTP API, search, sync and encrypted notes behave identically on both engines.

### Phase 1b: the client must work alone

Today notes live in a Node process (`node:sqlite`, FTS5). A phone cannot run that, so the same code has to run in the
browser:

- **SQL driver abstraction** under `NoteStore`: `node:sqlite` on desktop/CLI, `@sqlite.org/sqlite-wasm` (OPFS) in the
  browser. **Spike done (see below): FTS5 is included and works.**
- **Codec on WebCrypto** instead of `node:crypto` (AES-GCM is identical; scrypt becomes a pure-JS/wasm implementation or
  PBKDF2 with a format-version bump). Files written by the Node codec must stay readable.
- **The API runs in the page / a service worker**: the Hono app already exposes `app.fetch(request)`, so `api.ts` can
  keep calling `/api/...` and a service worker answers from the in-browser store. The UI does not change.
- Not available in the browser build: attachment text extraction (Poppler/Tesseract), the web clipper endpoint, the
  local-folder sync. Everything else (ENEX/Markdown import, editor, search, tasks, encrypted notes) is portable
  (`linkedom`, `fast-xml-parser`, `turndown`, `marked` and `fflate` all run in browsers).
- Hosting: the browser build is static files, so GitHub Pages is enough (cost: zero). It is also the OAuth origin.

### Phase 2: Google Drive

- **Scope: `https://www.googleapis.com/auth/drive.appdata`** only. Notes go to the hidden *application data folder*:
  OpenNote cannot see or touch anything else in the user's Drive, and the user does not see the files in Drive.
- **Sign-in**: Google Identity Services token flow in the browser; OAuth for installed apps (PKCE, loopback redirect) in
  Electron. No client secret is needed or shipped. Access tokens are short-lived; refresh handled per platform. Tokens are
  kept in Electron `safeStorage` / the browser's IndexedDB (never in the synced files).
- **Mapping**: Drive has no real paths, so `notes/<id>/<device>.json` becomes one flat file per record in
  `appDataFolder`, named with the full path and tagged with an `appProperties` directory key so `list` is one query.
  `version` = `md5Checksum`.
- **`writeIfAbsent`**: Drive has no conditional create. Create, list by name, and keep the file with the earliest
  `createdTime`; the loser deletes its own. Only `format.json` needs this.
- **Atomicity**: a media update replaces content in one revision, so readers never see half a file.
- **Quota/polling**: first version lists everything every N minutes (default 5) and skips unchanged files by `version`;
  switch to the `changes` API (page tokens) to cut requests when libraries get large. Drive allows ~12 000 queries per
  100 s per project, far above single-user use.
- **Encryption is mandatory for remote destinations.** Google must only ever store ciphertext. The passphrase cannot be
  derived from the Google account (that would let Google decrypt), so it is entered once per device and kept in
  `safeStorage` (desktop) or as a non-extractable WebCrypto key in IndexedDB (browser). Folder sync keeps encryption
  optional, as today.

## What this needs from the project owner (cannot be done from code)

1. A **Google Cloud project** with the *Google Drive API* enabled.
2. **OAuth consent screen** (External), scope `drive.appdata` only. This scope is not "sensitive", so publishing needs
   brand verification but no security assessment. While in *Testing* it is limited to 100 listed users with a warning
   screen.
3. Two **OAuth client IDs**: *Web application* (authorised JavaScript origin = where the browser build is hosted) and
   *Desktop app*. Client IDs are public by design and live in the source.

## Risks and open questions

- ~~sqlite-wasm with FTS5 and OPFS must be proven~~ — proven, see the spike result below.
- **iOS Safari** can evict a site's storage after a week without use; an installed home-screen PWA is exempt, and with
  sync on the data can always be restored from Drive. The UI should say so.
- Large attachments: Drive uploads over ~5 MB should use resumable upload.
- Several devices polling Drive at once is fine; a conflict is resolved exactly as with folders (copy kept, nothing lost).

## Spike result: SQLite in the browser (done)

`@sqlite.org/sqlite-wasm` 3.53.4, run in a Web Worker in the browser pane, **without** cross-origin isolation headers
(so it also works on GitHub Pages):

- FTS5 is compiled in. OpenNote's **real schema** (`SCHEMA` from `server/src/db.ts`, 36 tables/indexes/triggers) applies
  unchanged, with `foreign_keys` on.
- Every search feature the store uses behaves like the Node build: prefix (`caf*`), accent-insensitive
  (`unicode61 remove_diacritics 2`: `cafe` finds `café`), `"exact phrases"`, `OR`, `NOT IN (… MATCH …)`, and ranking with
  `bm25(notes_fts, 0, 5, 1)` (a title hit ranks first).
- **Persistence works** through the OPFS *SAH-pool* VFS (`installOpfsSAHPoolVfs`): rows written in one page load, including
  the FTS index, were there after a reload. The classic `opfs` VFS is not usable without isolation headers, so use the
  SAH-pool one. It runs in `journal_mode=delete` (no WAL in the browser), fine for one writer.
- Speed: indexing 5 000 notes of ~300 words took 0.3–7 s depending on machine load (a one-off bulk load), and a full-text
  search over them 4–28 ms.
- Constraint that follows: SAH-pool holds an exclusive lock on the database, so **only one tab/worker can have it open**;
  the app must elect a single owner (Web Locks API) and have other tabs talk to it.

Phase 1 can go ahead. First step: put a small SQL-driver interface under `NoteStore` (`prepare/run/all/get/exec`), so
`node:sqlite` and sqlite-wasm are interchangeable.
