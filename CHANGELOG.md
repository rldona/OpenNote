# Changelog

All notable changes to OpenNote are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/). Installers are built and published by GitHub Actions
when a `v*` tag is pushed; the section of the tag becomes the release notes.

## [Unreleased]

### Added (Android and iOS apps)
- **New navigation**, after Evernote's 2024 mobile layout: a floating bar with Create, Notes, Notebooks and More, and a round
  search button beside it. Settings › Navigation chooses which three sections the bar shows (Notes is always there); the rest
  are in the More menu.
- **Create screen**: today's date, search, big *New note* and *New task* buttons, shortcuts (notebook, reminder, recorder,
  camera, document scanner on iPhone and iPad, files, sketch, templates) and a scratch pad that keeps what is typed in it
  until it becomes a note.
- **Account menu** (the round button at the top left): this device and its sync state, What's new, Trash, Settings and Help.
- **Voice notes**: record from the note's toolbar or the Create screen, with pause and a level meter; the recording is an
  audio attachment that plays in the note (AAC, .m4a), on every device.
- **Sketches**: a drawing pad with pen, highlighter, eraser, five inks and three widths; the drawing is added to the note as
  a PNG cut to what was drawn.
- **Photos, scans and files**: the camera (iOS and Android), the system document scanner (iOS) and the file picker add
  pictures and files to a note; photos are scaled to 2560 px.
- Note lists show the first picture of each note, the date and a count over the list; a green button creates a note there.
- A **Notebooks** screen and a **Tags** screen of their own, and a default notebook for new notes (Settings › Notebooks).
- Settings is a list of pages: Appearance, Navigation, Notebooks, Sync and About, with the version at the bottom.
- Android phones lose the green header with the logo: screens start under the status bar in the app's colours, with the
  account button at the top left, as on iOS; the status bar icons follow the app's theme.
- The note's toolbar is a floating pill: insert (sketch, scan, table, divider), camera, recorder, files, checklist, lists,
  indent and outdent, then text formatting.

### Added (every app)
- **Your Google account on the account button.** Once Google Drive sync is connected, the round account button shows the
  account's picture (or its initial), and its menu shows the name and email. It comes from Drive's own `about` call, allowed
  with the `drive.appdata` permission OpenNote already has: no new permission, and nobody needs to connect again. The web
  and desktop apps gain the account button too, at the top of the sidebar and at the bottom of the icon rail, with What's
  new, Trash, Sync and Help.

### Fixed
- Android no longer starts on a black screen that turns light in the light theme: the window follows the system's
  light or dark mode, and the theme chosen in the app is remembered outside the database so the first frame uses it.
- Recordings and other attachments are served with byte ranges inside the mobile editor, which audio players need.
- Pictures and recordings inserted into a note go after the selected item instead of replacing it.

## [0.5.0] - 2026-10-19

### Changed
- **Layouts for phones and tablets.** The window size now picks one of four layouts instead of a single 900 px switch:
  - wide windows (1280 px and up) keep sidebar, note list and note side by side;
  - 1024–1279 px (tablets in landscape, small laptops) keep the same three panes with narrower columns, so the note has more room;
  - 700–1023 px (tablets in portrait) show the note list beside the note, and the sidebar opens as a drawer over them;
  - phones (under 700 px, or a short landscape window) show one screen at a time: Home, a note list or a note. A bar at the
    bottom has Home, Notes, a New note button, Search and More (the sidebar, as a drawer). An open note fills the screen, with a
    back button in its header, and the formatting toolbar stays on one row that scrolls sideways.
- The split between the note list and the note (narrow windows, 0.4.3) is gone: the list and the note are now side by side or
  on separate screens. The saved split size is ignored.
- On touch screens buttons are at least 44 px, rename/delete show on the selected notebook (there is no hover), and the keyboard
  tip on Home is hidden. Installed on a phone, the app keeps clear of the notch and the home indicator and follows the visible
  height of the screen.
- **Note editor.** The title and tags now scroll with the note and only the formatting toolbar stays in place, so more of the
  note fits on screen. The toolbar is grouped: **Aa** (normal text, headings, quote, code block, strikethrough, highlight), bold /
  italic / underline, lists and checklists, link, and **+** to insert a file, table, divider, note link, audio or drawing. On
  phones it sits at the bottom of the note, right above the keyboard.
- The note header is a single row: the stack and notebook on the left, the note actions on the right. Tags moved under the
  title. On tablets and phones, History is in the ⋯ menu.
- **Tablets in landscape and small laptops** (1024–1279 px) show a rail of icons (new note, search, Home, All notes, Pinned,
  Tasks, Reminders, Notebooks, Trash, Sync) instead of the full sidebar, which opens from the rail as a drawer. The note gets
  about 160 px more width.
- **Sidebar.** A **Shortcuts** section lists pinned notes and saved searches. Stacks come before loose notebooks, with their
  notebooks indented under them, and fold with a click; Shortcuts, Notebooks and Tags fold too, and what you fold is remembered.
  Tags show the five most used, with **Show all** for the full tree. When sync is on, the footer says when it last ran ("Synced
  3 minutes ago", or a problem) and opens the sync panel.
- **New note ▾** replaces the template picker next to New note: a blank note or any of your templates.
- **Note list header** shows how many notes are in the list and has a **+** that creates the note in the notebook or tag you are
  looking at. Below it, filter chips narrow the list: open tasks, attachments, reminder, updated this week.
- **Home you can arrange.** **Customize** on Home moves widgets, hides them and brings them back (Tasks, Reminders, Notebooks,
  Pinned, Recent notes and a new Tags widget). Widgets fill each row whatever you pick, so the page has no gaps, and on phones
  recent notes are a row of cards to swipe through.
- **Search panel** (Ctrl/⌘+K, or /): results while you type, open one with ↑↓ and Enter, or show them all in the note list.
  One-tap chips add search operators (`tag:`, `notebook:`, `todo:true`, `resource:*`, `created:week`…) and complete tag and
  notebook names; recent and saved searches show while the field is empty. On phones it is the Search tab, full screen.
- **Swipe on phones:** in a note list, swipe a note to the right to pin or unpin it, to the left to move it to the trash.
- **Phones:** dialogs (history, sync, link to note, prompts…) and menus (sort, ⋯, appearance) open as sheets from the bottom of
  the screen, with larger rows.

## [0.4.3] - 2026-10-19

### Added
- **The sidebar hides by itself in a narrow window** (900 px or less) and comes back when the window is wide again. In a narrow
  window the sidebar button still opens it by hand, and choosing a section closes it again. Your own show/hide choice for wide
  windows is kept separately.
- **Resizable split between the note list and the note.** In a narrow window the list sits above the note (20% / 80%). Drag the
  bar between them to give more room to either; the list can shrink to 15% but never disappears, and the note keeps at least
  20%. Double-click the bar (or press Home on it) to go back to 20/80; the arrow keys move it in small steps. The size is
  remembered.

### Fixed
- **Reloading the page no longer sends you back to Home.** The address now says where you are (`#/notebook/…/note/…`, `#/tag/…`,
  `#/tasks`, `#/notes`…), so reloading, the browser's back and forward buttons and a copied link all return to the same section and
  the same open note. Older note links keep working, and an address that points to a notebook that no longer exists falls back to
  "All notes".
- Web sync panel: when Google says it needs you to connect again, the status now shows Google's reason and a **Connect again**
  button that reconnects and syncs straight away (before, the panel said "Connected" and offered no way out except Disconnect).
- **Web version: Google's account chooser kept appearing** even after signing in. The access token only lived in memory, so every
  reload needed a new one, and OpenNote did not tell Google which account to use, so with several Google accounts open in the
  browser it asked every time. The token (valid about an hour, limited to OpenNote's hidden Drive folder) is now kept in the browser
  while it is valid, and the account is remembered and passed to Google as a hint. After one more choice of account it should stop
  asking; disconnecting forgets both.
- macOS desktop app: in a narrow window, the strip used to drag the window sat in the middle of the note area; it now only exists
  where the note area is at the top of the window.

## [0.4.2] - 2026-10-19

### Fixed
- **Desktop app: "No se pudo buscar actualizaciones: GitHub answered 403".** The update check used GitHub's public API, which allows
  only 60 requests an hour per internet address (shared by everyone behind the same router), so it could fail for no reason of its
  own. Each release now publishes a small `latest.json` next to the installers and the app reads that, which is an ordinary file
  download with no such limit. It also carries the size and SHA-256 of every installer.

## [0.4.1] - 2026-10-19

### Fixed
- **Desktop app: Google Drive sync could not be connected** ("not set up in this build"). The installers now include the Google
  sign-in credentials for the desktop app, so **Connect Google Drive** works in the sync panel.

## [0.4.0] - 2026-10-19

### Added
- **Desktop app: sync with Google Drive.** In the sync panel choose **Google Drive** next to the folder option, connect in your
  browser, set the passphrase and sync. It keeps working without asking again every hour. Needs the one-time Google Cloud
  setup in `docs/GOOGLE-DRIVE-SETUP.md` (a second, "Desktop app" client); until then the panel says it is not set up.

### Fixed
- **macOS desktop app: a crash when closing or quitting** ("A JavaScript error occurred in the main process: Object has been
  destroyed"). The code that adapts the page to the unified title bar touched a window that had already been closed, and the error
  left the app half quit (window still open, notes server already stopped, "OpenNote is not running" banner). Every window access now
  checks that the window is still alive, uncaught errors are logged instead of interrupting the app, and the smoke test closes
  windows at several moments of their load.
- Web sync panel: the **Sync automatically** checkbox could not be changed (it saved the value it already had); it now works.
- Web sync panel: it closes by itself, with a confirmation message, when **Sync now** finishes well; if the sync fails it stays open
  showing the problem.
- Web version: the sync panel could stop opening until the page was reloaded (after the browser put the service worker to sleep it
  forgot which tab holds the notes database). The service worker now finds it again, the panel shows an error with a Retry button
  instead of staying blank, and when the tab that holds the database is closed another open tab takes over.

### Added
- Web version: after the first successful sync to Google Drive, automatic sync turns itself on; it also syncs when you come
  back to the tab or the connection returns.
- Web version: when Google's hourly access renewal is blocked by the browser, OpenNote says so and renews with your next click
  anywhere in the page, then resumes syncing.

### Fixed
- Web version: on the very first visit the app could start before its service worker was in control and show an empty library; it now waits longer and reloads itself once if needed.
- Web version: a new release now shows up on the next visit instead of up to ten minutes later (the page is revalidated).

### Added
- **Sync with Google Drive (web version), built but not switched on yet.** Connect your Google account, choose a passphrase, and
  your notes sync between every browser where you do the same. Notes are encrypted on your device first; Google only stores
  unreadable files in a hidden app folder of your Drive that no other app can see. It needs a one-time Google Cloud setup by the
  project owner: see `docs/GOOGLE-DRIVE-SETUP.md`.
- **Web version at https://rldona.github.io/OpenNote/** (GitHub Pages): the whole app in your browser, with no server and no
  account. Your notes are stored in that browser, on that device. Installable as an app from the browser menu. It does not sync
  yet; that is the next step.
- **OpenNote can run entirely in a browser, with no server** (`npm run build:standalone`, static files in
  `web/dist-standalone`). Same interface and same code: the database (SQLite compiled to WebAssembly) and the notes live in the
  browser's own storage. Not published anywhere yet; this is the groundwork for opening your notes on a phone or tablet.

### Fixed
- Markdown export of a note works the same everywhere (the Markdown converter now receives a parsed document instead of text).

### Changed
- Sync internals: the merge engine now talks to a storage **transport** instead of the file system, so more destinations
  (Google Drive, WebDAV…) can be added without touching the merge rules. Folder sync behaves exactly as before.
  See `docs/SYNC-BACKENDS.md` for the plan.
- The note store now sits on two small interfaces (SQL database, attachment storage) instead of Node's SQLite and file system
  directly. Nothing changes for users; it is the groundwork for running OpenNote in the browser. The test suite runs on both
  Node's SQLite and sqlite-wasm.

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

[Unreleased]: https://github.com/rldona/OpenNote/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/rldona/OpenNote/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/rldona/OpenNote/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/rldona/OpenNote/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/rldona/OpenNote/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/rldona/OpenNote/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/rldona/OpenNote/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/rldona/OpenNote/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rldona/OpenNote/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/rldona/OpenNote/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rldona/OpenNote/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rldona/OpenNote/releases/tag/v0.1.0
