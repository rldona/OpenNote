# Mobile, phase 0 (spike): results

Kotlin Multiplatform for Android and iOS, as decided in the mobile proposal. The spike answers whether the core can be
shared without breaking sync with the TypeScript apps, and whether a Compose UI with the web editor embedded holds up.
Done on 19 Oct 2026 on a Mac with Xcode 27.1 (iOS 27 simulators) and an Android 37 emulator; **no real devices yet**.

Versions: Kotlin 2.4.21, Compose Multiplatform 1.12.2, AGP 9.4.1, Gradle 9.6.0, androidx.sqlite (bundled) 2.7.1,
cryptography-kotlin 0.6.0 (JDK provider on JVM/Android, CryptoKit on iOS).

## What was built

- **Contract** ([SYNC-FORMAT.md](SYNC-FORMAT.md)): the sync format written down as a normative spec, and fixtures generated
  by the TypeScript engine (`npm run fixtures:sync -w server`): a plain and an encrypted location with conflicts, a tombstone,
  an attachment, a template, unicode and emoji, plus `expected.json`.
- **Kotlin core** (`mobile/shared`): JSON text identical to `JSON.stringify`, SHA-256 / HMAC / PBKDF2 / scrypt in common
  Kotlin, the AES-GCM codec, checksums, content hashes, derived ids, version vectors.
- **Editor bundle** (`web/src/embed`, `npm run build:embed -w web`): the TipTap editor alone with a message bridge. The note
  schema moved to `web/src/editorSchema.ts`, shared by the web editor and the bundle.
- **Apps**: a Compose screen with 1 000 notes and a note screen (native header and title, web editor body, native
  formatting bar above the keyboard), on Android and iOS.

## Results against the exit criteria

| Criterion | Result |
| --- | --- |
| Sync and encryption compatible both ways | **Met.** Kotlin reads both TypeScript locations and reproduces every checksum, content hash, scrypt key, derived id and attachment name, on the JVM and in the iOS simulator. A location written by Kotlin (from the JVM and from iOS) is read by a fresh TypeScript device with the same notes (`server/test/sync-fixtures.test.ts`). |
| Search under 100 ms with 5 000 notes | **Met.** Bundled SQLite has FTS5 with `remove_diacritics 2`: `cafe` finds `café`, phrases, prefixes, `NOT` and bm25 with the title weighted all match the web. Search: 13 ms (JVM), 31 ms (iOS simulator, debug). Indexing 5 000 notes: 0.15 s (JVM), 3 s (iOS debug). |
| Editor embedded with a native formatting bar | **Met.** Same rendering on Android and iOS (checklists with due dates, headings), the bar reflects the editor state (bold on/off) and its commands apply. One WebView, created at start and reused between notes. |
| 60 fps scrolling on a mid-range Android | **Not measurable here.** The emulator is the bottleneck: the system Settings app scrolls with 89 % janky frames on it. Needs a real device with the release APK (6.7 MB, R8). |
| Native feel on iOS (your call) | **Pending your review**, with the issues below. |

## Issues found (to fix in phase 2)

1. **iOS: swipe from the left edge does not go back.** The Compose `BackHandler` does not get the gesture in this setup.
   Use the Compose navigation library (iOS back gesture support) or our own edge-pan.
2. **iOS: the WebView draws over Compose during the slide transition** (native views are not part of Compose's animation).
   Hide the WebView, or show a snapshot of it, while a transition runs.
3. **iOS: WKWebView adds its keyboard accessory bar** (↑ ↓ ✓) under our formatting bar. Remove it (`inputAccessoryView`).
4. **iOS: scrypt takes 1.35 s and the first frame several seconds** in the simulator's debug build. Measure the release build
   on a device; keep the derived key in the Keychain so scrypt runs once per device.
5. **Android: `adb` input triggered Gboard's stylus tutorial** in the emulator; typing, bold and back worked once dismissed.
   The soft keyboard with `imePadding` still has to be checked on a device.
6. Fixed during the spike: the editor folder name in the iOS bundle, list scroll position lost when coming back from a note,
   CommonCrypto lacking AES-GCM (CryptoKit provider).

## Not covered

Real devices (iPhone, iPad, mid-range Android), Android running the shared tests (FTS5 on Android natives), iPad and
landscape layouts, the soft keyboard on iOS, Google sign-in, CI for `mobile/`.

## Next

Phase 1 (core): port `NoteStore`, search query parsing and the sync engine with the three-device scenarios, Google Drive
transport and OAuth, and add `mobile/` to CI (shared tests on JVM and iOS simulator, plus the TypeScript read-back).
