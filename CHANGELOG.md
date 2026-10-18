# Changelog

All notable changes to OpenNote are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/). Installers are built and published by GitHub Actions
when a `v*` tag is pushed; the section of the tag becomes the release notes.

## [Unreleased]

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

[Unreleased]: https://github.com/rldona/OpenNote/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/rldona/OpenNote/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rldona/OpenNote/releases/tag/v0.1.0
