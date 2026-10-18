# OpenNote desktop

The desktop app is OpenNote with its server embedded in Electron. Same data, same features, no terminal needed,
and nothing leaves your computer.

| System | Installer | Notes |
| --- | --- | --- |
| macOS (Apple Silicon and Intel) | `OpenNote-<version>-mac-arm64.dmg`, `…-mac-x64.dmg` | Drag OpenNote to Applications |
| Windows (x64 and arm64) | `OpenNote-<version>-win-x64.exe`, `…-win-arm64.exe` | NSIS installer, per user, choose the install folder |
| Linux (x64 and arm64) | `OpenNote-<version>-linux-amd64.deb`, `…-linux-arm64.deb` | `sudo apt install ./OpenNote-*_<your arch>.deb`, then run `opennote` or use the launcher |

**Installers are produced only by GitHub Actions** (`.github/workflows/desktop.yml`), on real macOS, Windows and Linux
runners, and attached to each GitHub Release. Nobody builds release installers by hand.

To publish a release, push a version tag; CI sets the app version from it, tests, builds the three installers,
smoke-tests them, and creates the Release:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

Every push to `main` and every pull request also builds the installers (kept as workflow artifacts for 90 days), so
you can download and try a build from the *Actions* tab.

## Unsigned builds

The installers are **not code signed or notarized** (that needs paid developer certificates), so the first launch
shows a warning:

- **macOS** (Gatekeeper): the app has a valid *ad-hoc* signature but no Apple Developer ID, so macOS says it cannot verify
  the developer. Open it once from *System Settings → Privacy & Security → Open Anyway* (macOS 15 and later removed the
  right-click bypass), or run `xattr -dr com.apple.quarantine /Applications/OpenNote.app` once in the Terminal.
  If macOS says OpenNote **"is damaged and can't be opened"**, you have a build from before this signature fix (v0.1.0):
  the same `xattr` command opens it, and newer releases do not need it.
- **Windows** (SmartScreen): *More info* → *Run anyway*.
- **Linux**: no warning for `.deb` packages.

To produce signed builds, remove `mac.identity: null` from `electron-builder.yml` and provide the usual
electron-builder variables (`CSC_LINK`, `CSC_KEY_PASSWORD`, or `CSC_NAME` on macOS, plus `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization; `WIN_CSC_LINK` for Windows). Without them nothing is
ever signed: the build deliberately ignores any certificate in your keychain.

## What the app adds to the web version

- Native menus for each system, a tray / menu bar icon, single-instance and window position memory
- **Quick note**: a global shortcut (default `Ctrl/Cmd+Alt+N`, configurable in *Settings*) opens a small always-on-top
  window; the first line is the title. `Ctrl/Cmd+Enter` saves, `Esc` cancels. On some Linux desktops (Wayland) global
  shortcuts are not allowed; the app tells you and the tray menu still opens the quick note
- Native notifications for reminders
- *Import ENEX / Markdown / HTML / zip* from the File menu, *Open notes folder* from Help
- *Settings*: shows and changes the notes folder (default `~/.opennote`, the same one the command line version uses)

On macOS closing the window keeps OpenNote in the menu bar; on Windows and Linux closing the last window quits.

## Security

`contextIsolation` on, `nodeIntegration` off, `sandbox` on. The window can only show the local OpenNote origin
(other links open in your browser), webviews are blocked, and only notifications, audio recording, clipboard writes
and fullscreen are granted to that origin. The server listens on `127.0.0.1` only. The only IPC channels are the
fixed ones for the quick-note and settings windows, and each checks that the caller is its own bundled page.

## Develop

For working on the app itself (CI is what produces installers):

```bash
npm install
node node_modules/electron/install.js     # downloads the Electron binary (npm skips install scripts)
npm run desktop:dev                        # builds the UI, bundles the app and opens it
npm run smoke -w desktop                   # boots the real app headlessly and checks server, UI and full-text search
npm run desktop:pack                       # unpacked app in desktop/release, to inspect packaging problems
```

On Linux, the smoke test needs a display, e.g. `xvfb-run -a npm run smoke -w desktop`.

`node:sqlite` with FTS5 ships inside Electron 44 (Node 24), so no native modules are compiled or bundled.
