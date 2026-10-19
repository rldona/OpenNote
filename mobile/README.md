# OpenNote for Android and iOS

Kotlin Multiplatform. The core (`shared/`) and the UI (`composeApp/`, Compose Multiplatform) are common to both platforms; the
body of a note is the web editor (`web/src/embed`) in the platform's WebView, so notes read and save exactly as on the web
and desktop. The sync format is shared with the TypeScript apps and specified in [docs/SYNC-FORMAT.md](../docs/SYNC-FORMAT.md).

```
shared/       the data layer: store, search, sync engine, encryption, Google Drive and sign-in; JVM, Android, iOS
composeApp/   UI (Compose Multiplatform) and the WebView hosts of the editor
androidApp/   Android entry point; ships web/dist-embed as assets/editor
iosApp/       iOS entry point (SwiftUI host), Xcode project generated with XcodeGen from project.yml
```

## Build and run

Needs JDK 21, the Android SDK (`local.properties` with `sdk.dir=…`), Xcode and XcodeGen for iOS, and the editor bundle:

```bash
npm run build:embed -w web
```

```bash
cd mobile && ./gradlew :shared:jvmTest :shared:iosSimulatorArm64Test
```

```bash
cd mobile && ./gradlew :androidApp:assembleDebug
```

```bash
cd mobile/iosApp && xcodegen generate && xcodebuild -project OpenNote.xcodeproj -scheme OpenNote -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

The shared tests read the contract fixtures in `server/test/fixtures/sync-v1` and write a location to
`shared/build/sync-fixtures-kotlin`, which `server/test/sync-fixtures.test.ts` then reads back with the TypeScript engine.

## Status

Phases 1 (core) and 2 (interface) done; next is phase 3 (Google sign-in, notifications, Share, background sync). Details and open points: [docs/MOBILE-SPIKE.md](../docs/MOBILE-SPIKE.md).
CI: `.github/workflows/mobile.yml`.
