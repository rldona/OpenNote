package app.opennote.sync

import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.readByteArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

expect fun env(name: String): String?

/**
 * The repository root, set by the Gradle test tasks (shared/build.gradle.kts). Tests in the iOS simulator run on this Mac,
 * so they read the same files by absolute path.
 */
val REPO: String = env("OPENNOTE_ROOT") ?: error("OPENNOTE_ROOT is not set; run the tests through Gradle")

/** Where the contract fixtures written by the TypeScript implementation live (docs/SYNC-FORMAT.md 6). */
val FIXTURES = "$REPO/server/test/fixtures/sync-v1"

/** Where the Kotlin implementation leaves a location for server/test/sync-fixtures.test.ts to read back. */
val KOTLIN_LOCATION = "$REPO/mobile/shared/build/sync-fixtures-kotlin"

fun readBytes(path: String): ByteArray = SystemFileSystem.source(Path(path)).buffered().use { it.readByteArray() }

fun readText(path: String): String = readBytes(path).decodeToString()

fun readJsonObject(path: String): JsonObject = parseJson(readText(path)).jsonObject

fun listNames(path: String): List<String> = SystemFileSystem.list(Path(path)).map { it.name }.sorted()

fun writeBytes(path: String, bytes: ByteArray) {
    Path(path).parent?.let { SystemFileSystem.createDirectories(it) }
    SystemFileSystem.sink(Path(path)).buffered().use { it.write(bytes) }
}

fun deleteRecursively(path: String) {
    val p = Path(path)
    if (!SystemFileSystem.exists(p)) return
    if (SystemFileSystem.metadataOrNull(p)?.isDirectory == true) SystemFileSystem.list(p).forEach { deleteRecursively(it.toString()) }
    SystemFileSystem.delete(p)
}
