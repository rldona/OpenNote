// The core shared by the Android and iOS apps: sync format, encryption, storage. No UI here.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.kmp.library)
}

kotlin {
    jvmToolchain(21)
    jvm()
    androidLibrary {
        namespace = "app.opennote.shared"
        compileSdk = libs.versions.android.compileSdk.get().toInt()
        minSdk = libs.versions.android.minSdk.get().toInt()
    }
    iosArm64()
    iosSimulatorArm64 {
        // Any simulator works; the tests only need one to run in.
        testRuns["test"].deviceId = providers.gradleProperty("iosTestDevice").getOrElse("iPhone 17")
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.io.core)
            implementation(libs.cryptography.core)
            // JDK on the JVM and Android, CryptoKit on iOS (CommonCrypto has no AES-GCM).
            implementation(libs.cryptography.provider.optimal)
            implementation(libs.androidx.sqlite.bundled)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

// The contract fixtures live in the TypeScript tree; tests read them from there and write the Kotlin location next to the
// build (server/test/sync-fixtures.test.ts reads it back).
val repoRoot = rootDir.parentFile.absolutePath
tasks.withType<org.jetbrains.kotlin.gradle.targets.native.tasks.KotlinNativeTest>().configureEach {
    environment("OPENNOTE_ROOT", repoRoot)
    environment("SIMCTL_CHILD_OPENNOTE_ROOT", repoRoot)
}
tasks.withType<Test>().configureEach {
    environment("OPENNOTE_ROOT", repoRoot)
    testLogging { events("failed"); showStandardStreams = true; exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
