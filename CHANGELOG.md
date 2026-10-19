# Changelog

All notable changes to OpenNote are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/). Installers are built and published by GitHub Actions
when a `v*` tag is pushed; the section of the tag becomes the release notes.

## [Unreleased]

### Changed
- Sync internals: the merge engine now talks to a storage **transport** instead of the file system, so more destinations
  (Google Drive, WebDAV…) can be added without touching the merge rules. Folder sync behaves exactly as before.
  See `docs/SYNC-BACKENDS.md` for the plan.

## [0.3.1] - 2026-10-19

### Fixed
- **Desktop app: the + button for a new notebook did nothing.** Electron does not support `window.prompt`, so every question
  that asked for text silently returned nothing. They now use an in-app window (new notebook, rename notebook, save search,
  insert link).

## [0.3.0] - 2026-10-18

### Changed
- **macOS: the title bar and the app are now one block.** The window no longer has a separate title bar colour: the window
  buttons sit on the sidebar and you can drag the window by the top of the sidebar and the headers. (Windows and Linux keep
  their native title bar.)

### Added
- **Updates from inside the app.** OpenNote looks for a new release once a day (and you can turn that off in Settings). When there
  is one, a window asks whether to **Update** or **Cancel**. Update downloads the installer for your system, checks its SHA-256
  and installs it: on macOS the app replaces itself and reopens, on Windows the installer runs silently and reopens the app, on
  Linux the `.deb` opens in your package installer. Your notes are never touched.
- **Check for updates…** in the app menu (Help menu on Windows and Linux), in the tray menu and in Settings.

## [0.2.0] - 2026-10-18

### Changed
- **New look**, following the direction of Evernote's 2024 redesign (a simpler layout that keeps the focus on your notes):
  the dark sidebar is gone in favour of a light, unified one; new colour palette; softer cards and rounded controls;
  SVG icons instead of emoji; a centred, more readable editor column.
- The search box moved to the top of the sidebar; note actions (reminder, pin, history, focus mode, more) are icon buttons.

### Added
- **Notebooks overview**: every notebook as a card with its note count and last update, grouped by stack.
- **Home** is now its own page (greeting, quick capture, tasks due, reminders, pinned notes, notebooks, recent notes).
- **Appearance menu**: theme (system / light / dark) and five accent colours, remembered on this device.
- **Note list options**: sort by last updated, date created or title; compact density.
- **Focus mode** (editor only) and a collapsible sidebar.
- Shortcuts: `/` jumps to search, Ctrl/⌘+N creates a note.

## [0.1.2] - 2026-10-18

### Fixed
- **macOS: the Dock icon looked much bigger than other apps.** The macOS icon now has the standard margin and a soft shadow
  (`desktop/build/icon-mac.png`); Windows and Linux keep the full-bleed icon.

## [0.1.1] - 2026-10-18

### Fixed
- **macOS: "OpenNote is damaged and can't be opened".** The app bundle is now signed ad-hoc (no certificate involved), so
  downloaded builds show the normal "unidentified developer" prompt instead. See `desktop/README.md` for how to open it.
- Releases now contain every installer: macOS Apple Silicon **and** Intel, Windows x64 **and** arm64, Linux amd64 **and** arm64
  (0.1.0 only shipped the architecture of each CI runner).

### Added
- `CHANGELOG.md`, and a repository cover image with the icon and name.
- `?lang=en` / `?lang=es` selects the interface language (remembered); otherwise the browser's language is used.

### Changed
- CI uses the Node 24 versions of the GitHub Actions (checkout, setup-node, upload/download-artifact, gh-release) and pins
  Ubuntu 24.04, so builds do not change when `ubuntu-latest` moves to a newer image.
- Release notes are taken from this file.

## [0.1.0] - 2026-10-18

First public build.

### Added
- **Notes**: notebooks and stacks, hierarchical tags (`a/b/c`), pinned notes, trash, rich editor (headings, lists, checklists,
  tables, code, links, images), templates, note links with backlinks, duplicate and merge, note history, reminders.
- **Search**: Evernote-style grammar (`tag:`, `notebook:`, `todo:`, `created:`, `updated:`, `intitle:`, `any:`, negation,
  `sourceUrl:`, `resource:`), saved searches, and search inside text files, PDFs (Poppler) and images (Tesseract OCR).
- **Tasks** view with due dates, and a **Home** dashboard.
- **Import / export**: ENEX (Evernote), Markdown, HTML, zip (Obsidian vaults and folders), zip export with attachments.
- **Encrypted notes**: AES-256-GCM in the browser, nothing readable on the server, in backups or in the sync folder.
- **Sync without a cloud**: through a folder you choose, with conflict copies instead of data loss and optional encryption.
- **Web clipper** extension for Chrome, Edge and Firefox.
- **Voice notes**, hand drawing, and previews for images, PDFs, audio, video and text.
- **Desktop app** (Electron) for macOS (.dmg), Windows (.exe) and Linux (.deb) with a tray icon, a global quick-note shortcut
  and native reminders; installable **PWA**.
- Local-only by design: the server listens on loopback only, with Host/Origin checks, a strict Content-Security-Policy and
  sanitized HTML.

[Unreleased]: https://github.com/rldona/OpenNote/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/rldona/OpenNote/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/rldona/OpenNote/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rldona/OpenNote/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/rldona/OpenNote/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rldona/OpenNote/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rldona/OpenNote/releases/tag/v0.1.0
