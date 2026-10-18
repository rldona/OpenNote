# OpenNote

A local-first, open source note-taking app with the workflow people know from Evernote:
notebooks, tags, rich-text notes with checklists and tables, attachments, powerful search,
a trash, reminders and note history. **Your notes live in a SQLite file on your machine.**
No account, no cloud, no telemetry.

> OpenNote is an independent project. It is not affiliated with or endorsed by Evernote.
> It contains no Evernote code, assets or branding. See [docs/FEATURES.md](docs/FEATURES.md)
> for how the feature set was defined.

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
- **Search** with an Evernote-style grammar, instant and typo-tolerant on accents:
  `milk bread`, `"exact phrase"`, `tag:work`, `notebook:Ideas`, `todo:true`, `resource:any`, `reminderTime:*`.
  Save any search to the sidebar
- **Note history**: automatic versions, restore any earlier one
- **Reminders** with in-app and desktop notifications
- **Import/export ENEX** (Evernote's documented export format) including tags, dates, checklists and
  attachments, so you can bring your notes over or leave at any time. Export a note as **Markdown**
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
web/src/              React client
```

## Limitations (MVP)

- Single user, single device: there is no sync yet (copy the data folder, or use ENEX)
- Markdown export is per note and references attachments as `attachments/<name>`; it does not bundle the files
- ENEX import loads the file in memory, so very large exports (hundreds of MB) may be slow
- Evernote-only features that need a server (shared notebooks, Spaces, AI) are out of scope

See the roadmap in [docs/FEATURES.md](docs/FEATURES.md).

## License

[MIT](LICENSE)
