# Mobile: status

Kotlin Multiplatform for Android and iOS, as decided in the mobile proposal. Phase 0 (spike) answered whether the core can be
shared without breaking sync with the TypeScript apps and whether a Compose UI with the web editor embedded holds up;
phase 1 ported the core; phase 2 built the real interface; phase 3 connected it to the platforms. Tested on a Mac with
Xcode 27.1 (iOS 27 simulators) and an Android 37 emulator; the app also installs and runs on an iPad Pro 11" (2018), but
**the real-device checks are still to do**.

Versions: Kotlin 2.4.21, Compose Multiplatform 1.12.2, AGP 9.4.1, Gradle 9.6.0, androidx.sqlite (bundled) 2.7.1,
cryptography-kotlin 0.6.0 (JDK provider on JVM/Android, CryptoKit on iOS), Ksoup 0.2.6, Ktor 3.6.0, kotlinx-datetime 0.8.0.

## Phase 4: the 2024 Evernote layout and capture, done (first part)

- **Navigation** (`Nav.kt`, `App.kt`): a floating bar with three sections chosen by the person (`Section`, stored as
  `ui.nav` in the meta table; Notes always included) plus More, a pop-up with the other sections; a round search button
  beside the bar. Settings and a note hide the bar.
- **Screens**: Create (`HomeScreen.kt`: date, search, New note / New task, capture shortcuts, scratch pad in `ui.scratch`,
  then tasks due, reminders, shortcuts and recent notes), Notebooks and Tags (`NotebooksScreen.kt`), note lists with the
  count, thumbnails (`NoteStore.firstImages`, decoded once in `Thumbnails`) and a new-note button, an account menu
  (`AccountButton`), and settings pages (`SettingsPage`: appearance, navigation, default notebook in `ui.defaultNotebook`,
  sync, about).
- **Capture** (`Media.kt` and its `actual`s): `Capture` for the camera (Android: the camera app through a FileProvider,
  scaled and turned upright; iOS: UIImagePickerController, the photo library in the simulator), the document scanner
  (VisionKit, iOS only) and the file pickers; `AudioRecorder` (MediaRecorder / AVAudioRecorder, AAC); `SketchDialog`
  (common Compose, exported with `encodePng`). Each becomes an attachment inserted at the cursor
  (`EditorController.insert`) or, from Create, a new note (`AppEnv.newNoteWith`).
- The editor page gained `indent`/`outdent`, and inserts after the selection. Attachments are served with byte ranges on
  both platforms (audio players need them).

Checked in the iPhone 17 simulator: the Create screen, the bar and More menu, navigation settings (hide and show), the
account menu, settings, a new task with the cursor in its checklist item, a sketch inserted into a note, and a voice note
recorded, inserted and showing its length in the player. Android builds; on a device: not yet. Not checked: the camera
and scanner on a real device (the simulator has neither), Android's camera, file picker and recorder.

## Phase 3: the platforms, done (with what is left below)

- **Secrets:** `SecretStore` is the Keychain on iOS (generic passwords, readable after the first unlock so background sync
  works with the phone locked, never in backups) and an AES-GCM key in the Android Keystore over private preferences. The
  Google refresh token, the sync passphrase and the key derived from it live there; the derived key is kept per salt, so
  scrypt runs once per device instead of on every launch. A passphrase stored in the database by earlier builds is moved
  out at start. `SyncEngine` takes the store as a parameter (the database's meta table by default: tests, JVM).
- **Google sign-in:** `GoogleAuth` (phase 1) driven by ASWebAuthenticationSession on iOS and Custom Tabs on Android, which
  comes back through `SignInRedirectActivity`. Client IDs are given to the build (`generateGoogleClients`, from a Gradle
  property or an environment variable, as CI variables); without one, Settings says sync is not set up in this build.
  Setup: [GOOGLE-DRIVE-SETUP.md](GOOGLE-DRIVE-SETUP.md). Settings: connect, passphrase, sync now, change passphrase,
  disconnect, last result and conflicts.
- **Sync, when:** `AppCore` holds the one open database for the UI, the notifications and the background work. It syncs
  four seconds after the last edit, when the app comes to the front and when it leaves (iOS grants a background task for
  it). In the background: a `BGAppRefreshTask` on iOS, WorkManager every hour with network on Android.
- **Reminders:** a note's reminder is a local notification (iOS: up to 60 at a time, the nearest; Android: alarms, exact
  when the person allowed them, set again after a restart or an update). Kept in step with the notes after every change and
  every sync. Tapping one opens the note. Permission is asked when the first reminder is scheduled.
- **Share to OpenNote (Android):** text, links (kept as the note's source URL), images and PDFs from any app's share sheet
  become a new note, opened at once.

Checked in the iPhone 17 simulator: the Keychain (save, replace, delete, with a signed build: an unsigned simulator build
has no Keychain, error -34018, so local simulator builds are now signed ad hoc), the permission prompt, a reminder
notification arriving and opening its note, the Settings section, and the system sign-in sheet opening for
accounts.google.com and cancelling cleanly. Android builds.

On a real iPad Pro 11" (2018) with the iOS OAuth client: sign-in with a Google account, the passphrase of the other
devices, and a sync that brought the notes written on the web and desktop apps.

Not checked yet: the background refresh (iOS does not run it in the simulator), and anything on Android beyond the build.

Left for later: a Share extension on iOS (it needs an App Group shared with the app), camera and document scanner.

## Phase 2: the interface, done

Compose screens on top of `NoteStore` (`composeApp/src/commonMain/kotlin/app/opennote/ui`):

- **Navigation** (`Nav.kt`, `App.kt`): a back stack of screens. Phones show a bottom bar (Home, Notes, new note, Search,
  More) and slide between screens; from 600 dp a navigation rail, and a note opens next to the list or search it came
  from (list–detail). The editor's WebView is hidden while a transition runs.
- **Back:** Android's system back; on iOS a pan from the left edge that drags the screen with the previous one underneath
  and goes back past 35 % of the width or on a flick. The current screen keeps its place in the tree during the drag, so
  the WebView under the finger is not re-created (that cancelled the touch).
- **Screens** (`screens/`): Home (greeting, quick capture, tasks due, reminders, pinned, notebooks, recent, tags); note
  lists with the web's quick filters, sorting, pull to sync and swipe actions (pin/restore, trash/delete); the note
  (notebook picker, reminder, pin, history, duplicate, save as template, title with autosave, tags, native format bar);
  search with operators and saved searches; More (lists, notebooks by stack with create/rename/delete, tags, trash);
  tasks grouped by due date; settings (theme and accent, stored in the database's meta table; Drive shown as coming in
  phase 3).
- **Attachments:** notes keep the web's `/api/attachments/<id>` URLs. Android serves them from `shouldInterceptRequest`;
  on iOS the editor is loaded from an `opennote://app/` scheme handler that serves both the bundled editor and the
  attachments, under one origin.
- Interface texts in English and Spanish, by the device's preferred language (on iOS `NSLocale.preferredLanguages`:
  `currentLocale` only offers the bundle's own localizations).

Checked in the iPhone 17 and iPad Pro 11" simulators: creating and editing notes (title and body reach the database and
survive a restart), list–detail, More, settings, dark theme including the editor, and the edge-swipe back. Android builds;
on the emulator only briefly, it is too slow on this Mac (see phase 0).

Testing note: the simulator tool's text input did not reach the simulator's pasteboard; `xcrun simctl pbcopy` followed by
the system Paste menu works.

## Phase 1: the core, done

`mobile/shared` now holds the whole data layer, method for method like the TypeScript server:

| TypeScript | Kotlin | Notes |
| --- | --- | --- |
| `schema.ts` | generated `Schema.kt` + `Database.kt` | The SQL is copied from `schema.ts` at build time (`generateSchema`), so there is one schema. Same migrations. |
| `store.ts` | `core/NoteStore.kt` | Notebooks and stacks, notes, trash, tombstones, hierarchical tags, saved searches, tasks with due dates, templates, versions, attachments, duplicate, merge, backlinks, sync bookkeeping. |
| `parseQuery` | `core/SearchQuery.kt` | All operators (`tag:` `notebook:` `todo:` `resource:` `reminderTime:` `created:` `updated:` `sourceUrl:` `intitle:` `any:`, negation, phrases, prefixes). |
| `html.ts` | `core/Html.kt` (Ksoup) | Text for search and snippets, task extraction and patching, sanitising. Clean HTML is kept byte for byte, so synced notes keep their content hash. |
| `blobs.ts` | `core/BlobStore.kt` | Files in the app sandbox, or memory. |
| `sync-transport.ts` | `sync/SyncTransport.kt` | Memory and folder transports with the same path rules. |
| `sync.ts` | `sync/SyncEngine.kt`, `SyncCodec.kt`, `SyncFormat.kt` | Same merge rules, records, checksums, encryption. Encryption is required by default (phones sync to Google Drive). |
| `sync-gdrive.ts` | `sync/GoogleDriveTransport.kt` (Ktor) | appDataFolder, one listing per run, md5 versions, multipart and resumable uploads, token refresh after 401, backoff on 429/5xx, first-creator-wins for `format.json`. |
| `google-oauth.ts` | `sync/GoogleAuth.kt` | PKCE with the app's own redirect URL (mobile OAuth clients have no secret); the refresh token goes to a `SecretStore` (Keychain/Keystore in phase 3). Opening the system browser is the platform's part (phase 3). |

### Tests (29, on the JVM and in the iOS simulator)

- **Contract** (`SyncContractTest`): the TypeScript fixtures, as in phase 0.
- **Store** (`NoteStoreTest`): notebooks, tags, trash and tombstones, every search operator with accents and ranking, tasks,
  templates, attachments and MD5, sanitising.
- **Sync** (`SyncEngineTest`): the scenarios of `server/test/sync.test.ts`: propagation with attachments, idempotence, edits,
  trash and deletion, concurrent edits with conflict copies (also with attachments), edit beats delete, three devices,
  damaged files and late attachment bytes, encryption and wrong passphrases.
- **Mixed devices** (`MixedDevicesTest`): a Kotlin device joins the encrypted location written by two TypeScript devices,
  gets every note identical, edits, adds a note with an attachment and deletes one, and syncs back; then
  `server/test/sync-fixtures.test.ts` syncs a fresh TypeScript device from that location and gets exactly the Kotlin notes.
- **Google Drive and sign-in** (`GoogleDriveTest`): against an in-memory Drive (`FakeDrive`, like `server/test/fake-drive.ts`)
  and a fake token endpoint: flat names, pagination, races, resumable uploads, retries, two phones syncing encrypted
  through Drive, PKCE, state check, token renewal, withdrawn access, disconnect.

### CI

`.github/workflows/mobile.yml` runs when `mobile/` or anything on the TypeScript side of the contract changes: the Kotlin
tests on Linux and the TypeScript read-back of the Kotlin location (required, not skipped), the Android build, and on macOS
the tests in the iOS simulator and the iOS app build. Not run on GitHub yet when this was written.

## Phase 0 issues: what happened to them

| Issue | Now |
| --- | --- |
| iOS: swipe from the left edge did not go back | **Fixed.** An edge-pan gesture on the Compose view (it also works over the editor's WebView) goes back once the finger has travelled far enough or flicked. It is not interactive yet (the screen does not follow the finger). |
| iOS: the WebView drew over the list during the slide | **Fixed.** The WebView is hidden while a transition runs and shows when it ends. |
| iOS: WKWebView's own keyboard bar (↑ ↓ ✓) under ours | **Fixed** in the Swift host (`iosApp`), with the usual content-view subclass trick. |
| iOS: scrypt 1.35 s and a slow first frame in the debug build | **Partly.** The derived key is now kept in the Keychain (phase 3), so scrypt runs once per device. The first frame still needs a release build on a device. |
| Android: soft keyboard and `imePadding` | **Open.** The emulator on this Mac is too loaded to judge (2 GB of RAM, constant swapping, ANRs even for system apps); needs a device. |
| Android: 60 fps scrolling on a mid-range phone | **Open.** Same reason. |

## Results of phase 0 (for reference)

Sync and encryption compatible both ways; bundled SQLite has FTS5 with `remove_diacritics 2` (search over 5 000 notes in
13 ms on the JVM, 31 ms in the iOS simulator); the embedded editor renders the same note schema on both platforms, its
state drives the native formatting bar, and one WebView is reused between notes.

## Next

- **Android on a device:** sign-in with the Android OAuth client, Share, reminders after a restart, background sync.
- **Phase 4, rest:** iOS Share extension, a document scanner on Android, then store builds (signing in CI).
- Real devices for the open points above.
