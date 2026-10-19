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
| 1b | Run OpenNote **without a local server**, entirely in the browser | **done** (not hosted yet) |
| 1c | Browser build hosted on GitHub Pages; sync engine and cipher run in the browser | **done** |
| 2 | `GoogleDriveTransport` + "Sign in with Google" | **built; first real sync to Google Drive worked** (setup: [GOOGLE-DRIVE-SETUP.md](GOOGLE-DRIVE-SETUP.md)); second-device pull still to verify |
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

### Phase 1b (done): the app running in the browser

`npm run build:standalone` writes static files to `web/dist-standalone`; any static file server can host them (try
`npx serve web/dist-standalone`). It is the same React UI and the same server code, running on the visitor's own device:

```
 page (React UI)  ──fetch/<img> /api/…──►  service worker  ──►  tab that owns the DB  ──►  DB worker
                                                                     (Hono app + NoteStore on sqlite-wasm, OPFS storage)
```

- `web/src/standalone/db-worker.ts`: opens sqlite-wasm on OPFS (SAH pool), applies the schema, creates the Hono app with
  `standalone: true` (no Host/Origin checks: there is no network) and answers requests posted by the page.
- `web/public-standalone/standalone-sw.js`: answers every same-origin `/api/…` request by asking the owner tab, and caches the
  app files so it opens offline. Because it answers *sub-resource* requests of a controlled page, `<img src="/api/attachments/…">`
  and uploads work with no change to the UI, even when the site is served from a sub-path such as `/OpenNote/`.
- `web/src/standalone/boot.ts`: registers the service worker, starts the worker, relays requests, and turns `<a download>`
  links to `/api/…` into fetch-and-save (a navigation is not answered by the service worker).
- One tab owns the database (a Web Lock). Other tabs of the same site work through it; if the owner tab is closed they must
  be reloaded.
- Browser stand-ins for Node modules (Vite aliases, only in this build): `shims/crypto.ts` (md5/sha256 via `@noble/hashes`,
  random ids) and `shims/node-stub.ts` (fs/path/os/net/dns/child_process: present so the imports resolve, throw if used). The
  folder-sync, web-clipper and attachment-indexing code is bundled but never runs there. Attachments are stored in the database
  (`SqlBlobStore`).
- Found and fixed along the way: `turndown`'s browser build needs `DOMParser` (absent in workers), so Markdown/zip export now
  hands it a `linkedom` node instead of a string; sqlite-wasm rejects an empty bind list.
- Verified in Chrome with the built files served by a plain static server: notes, accent-insensitive search, tags, tasks,
  attachments (upload and read back), Markdown/ENEX/zip export, Markdown import, persistence after reload, and a second tab
  sharing the same data. Not covered: Firefox and Safari (OPFS SAH pool and service workers differ), other tabs after the owner
  closes, very large attachments. The in-app browser of the desktop tool cannot register service workers, so it cannot run this build.

### Phase 1c (done): hosted, and the sync engine runs in the browser

- **Hosting**: `.github/workflows/pages.yml` builds the browser build on every push to `main` that touches the web or server
  code and publishes it to GitHub Pages: **https://rldona.github.io/OpenNote/** . Static files only; notes never reach GitHub.
- **Sync engine in the browser**: the engine is unchanged. `shims/crypto.ts` now also provides AES-256-GCM, HMAC-SHA256,
  scrypt and constant-time compare (`@noble/ciphers`, `@noble/hashes`), synchronous and **byte-for-byte compatible with Node**
  (tests encrypt on one side and decrypt on the other, and compare scrypt output with the same parameters the sync folder
  uses), so a store written by the desktop app can be read in the browser and the other way round.
- **Diagnostic**: `await opennoteSelfTest()` in the browser console runs two simulated devices (throw-away in-memory databases)
  through the engine with a passphrase, an attachment, an edit and a check that the stored files hold no plain text. In Chrome
  it passes (about 3.7 s the first time, before the derived key was cached).
- The derived sync key is now cached in memory (scrypt costs about a second in JavaScript).
- **No destination yet in the browser**: the folder-path sync panel needs a Node server, so the sync button is hidden in the
  browser build until a destination exists (Google Drive, phase 2).
- Still open: Firefox and Safari checks; a friendlier message when a browser lacks service workers, Web Locks or OPFS; the up to
  3 s wait for the service worker on the very first visit.

### Design notes for phase 1b (original plan)

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

### Phase 2 status

Built (`server/src/sync-gdrive.ts`, `web/src/standalone/google-auth.ts`, the sync panel):

- `GoogleDriveTransport`: Drive API v3 over `fetch`, appDataFolder only. One paginated listing per run builds an index of file
  names (the full path is the file name); changed files are found by md5Checksum; resumable upload above 5 MB; a new token after a
  401, backoff on 429/5xx; the oldest of two same-named files wins (`writeIfAbsent`).
- Tested against `test/fake-drive.ts`, an in-memory Drive API: the same contract tests and the same three-device engine scenarios
  (edits, conflicts, deletions, encryption) as the in-memory transport pass over it.
- The engine refuses to write to a remote without a passphrase (`requireEncryption`): Google only ever stores ciphertext.
- Browser sign-in with Google Identity Services (token flow, `drive.appdata` only). The page gets the token and the database
  worker asks the page for it. The sync panel has a Drive section: connect, passphrase, auto-sync interval, status.
- **Verified against the real Google** (2026-10-19): connecting an account in Chrome, then a first sync that pushed 3 notes with
  `ok` status. Not yet verified: a second device pulling them, token renewal after the first hour, large attachments, Firefox/Safari.

Desktop app and command line (`server/src/google-oauth.ts`): the same engine and the same Drive transport, with a sign-in the
"installed application" way: system browser → one-shot server on `127.0.0.1` → code exchanged with PKCE → refresh token kept in the
local database → access tokens renewed silently (no hourly click, unlike the browser build). The engine now holds both a folder and
the remote and the user picks (`sync.backend`); the sync panel has the choice. Needs a second OAuth client of the *Desktop app*
type: see GOOGLE-DRIVE-SETUP.md. Tested against a fake Google (token endpoint with a PKCE check, loopback listener, revoked
permission, wrong state, denied access); not yet run against the real Google.

Browser build, renewal: when the browser blocks Google's hourly silent renewal, OpenNote says so and renews with the next click
anywhere (verified against the real Google).

Still to do: first real desktop sign-in (needs the Desktop OAuth client), Firefox/Safari.

### Phase 2: Google Drive (original design)

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
