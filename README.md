# OpenNote

A local-first, open source note-taking app with the workflow people know from Evernote:
notebooks, tags, rich-text notes with checklists and tables, attachments, powerful search,
a trash, reminders and note history. **Your notes live in a SQLite file on your machine.**
No account, no cloud, no telemetry.

> OpenNote is an independent project. It is not affiliated with or endorsed by Evernote.
> It contains no Evernote code, assets or branding. See [docs/FEATURES.md](docs/FEATURES.md)
> for how the feature set was defined.

## Desktop app

Installers for **macOS (.dmg)**, **Windows (.exe)** and **Linux (.deb)** are built by GitHub Actions and attached to each release; see
[desktop/README.md](desktop/README.md) (they are unsigned, so the first launch shows a system warning that file explains how to bypass).
They add a tray icon, a global **quick note** shortcut and native reminders, and use the same `~/.opennote` data.

## Quick start

Requires Node.js 24+ (uses the built-in `node:sqlite` with FTS5).

```bash
npm install
npm start          # builds the UI and serves it at http://localhost:3737
```

Development with hot reload (UI on :5173, API on :3737):

```bash
npm run dev
```

Data is stored in `~/.opennote` (override with `OPENNOTE_DATA=/some/dir`; change the port with `PORT`).
Back up that folder and you have backed up everything.

## Features

- **Notebooks and stacks**, **tags**, pinned notes, **trash** with restore
- **Rich editor** (TipTap): headings, bold/italic/underline/strike/highlight, lists, **checklists**,
  quotes, code blocks, **tables**, links, images (paste or drag & drop), file attachments
- **Voice notes** (record in the editor), **hand drawing**, and **previews** of images, PDFs, audio, video and text files
- **Hierarchical tags** (`work/projects/alpha`, with a collapsible tree and roll-up counts)
- **Tasks view**: every checklist item across your notes, with **due dates** (overdue / today / next 7 days),
  tick them off without opening the note
- **Templates** (meeting notes, weekly review…, or save any note as one) with `{{date}}` / `{{time}}`
- **Note links** (`⛓` in the toolbar) with **backlinks**, **duplicate** and **merge** notes (Ctrl/Cmd-click to multi-select)
- **Search** with an Evernote-style grammar, instant and accent-insensitive:
  `milk bread`, `"exact phrase"`, `-word`, `any: a b`, `intitle:x`, `tag:work` (includes sub-tags), `-tag:x`,
  `notebook:Ideas`, `todo:true`, `resource:any`, `reminderTime:*`, `created:month`, `updated:day-1`, `-created:20240101`,
  `sourceUrl:example.com`. Save any search to the sidebar
- **Encrypted notes**: lock any note with a passphrase (AES-256-GCM in the browser; the server, the database, backups and
  the sync folder only ever see ciphertext). Titles, tags and attachments are not encrypted; a lost passphrase cannot be recovered
- **Home** dashboard, installable **PWA**, and a clear banner when the local server is not running
- **Note history**: automatic versions, restore any earlier one
- **Reminders** with in-app and desktop notifications
- **Import/export ENEX** (Evernote's documented export format) including tags, dates, checklists and
  attachments, so you can bring your notes over or leave at any time
- **Import Markdown / HTML / zip** (Obsidian vaults and folders become notebooks and stacks, relative images become
  attachments) and **export everything as a zip** of Markdown files plus attachments; export single notes as Markdown
- **Web clipper** (Chrome, Edge, Firefox): save articles, pages, selections, bookmarks and screenshots, with images
  downloaded into the note — see [extension/README.md](extension/README.md)
- **Sync between devices without any cloud**: through a folder you choose (Syncthing, iCloud Drive, Dropbox, USB…),
  with conflict copies instead of data loss and optional AES-256 encryption — see [docs/SYNC.md](docs/SYNC.md)
- Light/dark theme, English and Spanish UI
- Loopback-only server: Host and Origin checks protect your notes from other websites

## How it is built

| Layer | Choice |
| --- | --- |
| Storage | SQLite (`node:sqlite`), FTS5 full-text index, attachments as files |
| API | [Hono](https://hono.dev) REST API (`server/src/app.ts`) |
| UI | React + [TipTap](https://tiptap.dev) (`web/`) |
| Tests | Vitest (`npm test`) |

```
server/src/store.ts   notes, notebooks, tags, versions, search
server/src/enex.ts    ENEX <-> HTML conversion (ENML, en-todo, en-media)
server/src/app.ts     HTTP API and local-only protections
server/src/sync.ts    serverless folder sync
server/src/clip.ts    web clipper endpoint
extension/            browser extension (TypeScript)
desktop/              Electron app (TypeScript)
web/src/              React client
```

## Limitations (MVP)

- Single user (sync is by shared folder, not a hosted service; there is no real-time collaboration or note sharing)
- Single-note Markdown export references attachments as `attachments/<name>` without bundling them (use the zip export for that)
- ENEX import loads the file in memory, so very large exports (hundreds of MB) may be slow
- Evernote-only features that need a server (shared notebooks, Spaces, AI) are out of scope

See the roadmap in [docs/FEATURES.md](docs/FEATURES.md).

## License

[MIT](LICENSE)
