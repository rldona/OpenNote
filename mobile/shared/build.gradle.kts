// The core shared by the Android and iOS apps: sync format, encryption, storage. No UI here.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.kmp.library)
}

// The database schema has one source, server/src/schema.ts (the TypeScript apps use it as is): it is copied into a Kotlin
// constant at build time, so the two can never drift apart.
val generateSchema = tasks.register("generateSchema") {
    val source = rootDir.resolve("../server/src/schema.ts")
    val out = layout.buildDirectory.dir("generated/schema")
    inputs.file(source)
    outputs.dir(out)
    doLast {
        val ts = source.readText()
        val sql = ts.substringAfter("export const SCHEMA = `").substringBefore("`;")
        require(sql.isNotBlank() && !sql.contains("\${")) { "unexpected SCHEMA in schema.ts" }
        val dir = out.get().asFile.resolve("app/opennote/core").apply { mkdirs() }
        val literal = sql.replace("\\", "\\\\").replace("\"", "\\\"").replace("${'$'}", "\\${'$'}").replace("\n", "\\n")
        dir.resolve("Schema.kt").writeText(
            "// Generated from server/src/schema.ts by shared/build.gradle.kts (generateSchema). Do not edit.\n" +
                "package app.opennote.core\n\ninternal const val SCHEMA: String = \"$literal\"\n",
        )
    }
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
            implementation(libs.ksoup)
            implementation(libs.kotlinx.datetime)
            implementation(libs.ktor.client.core)
        }
        commonMain {
            kotlin.srcDir(generateSchema)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
        }
        jvmMain.dependencies {
            implementation(libs.ktor.client.okhttp)
        }
        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
        }
        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
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
