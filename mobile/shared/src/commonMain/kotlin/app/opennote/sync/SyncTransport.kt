package app.opennote.sync

import kotlin.random.Random
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.readByteArray

/** A file in a sync location; [version] changes whenever the content does (mtime+size, ETag, md5…). */
data class TransportEntry(val name: String, val version: String)

/**
 * Where synced files are stored (server/src/sync-transport.ts). Paths are relative, `/`-separated and made of safe
 * segments only. Writes must be atomic and a path must never escape the root.
 */
interface SyncTransport {
    /** Files and folders directly inside [dir] ("" is the root). A missing folder is an empty list. */
    suspend fun list(dir: String): List<TransportEntry>
    suspend fun read(path: String): ByteArray?
    suspend fun write(path: String, data: ByteArray)
    /** Creates the file only if it does not exist yet; false when somebody else created it first. */
    suspend fun writeIfAbsent(path: String, data: ByteArray): Boolean
    suspend fun remove(path: String)
    suspend fun exists(path: String): Boolean
}

private val SEGMENT = Regex("^\\w[\\w.-]*$")

/** Rejects anything that is not a plain relative path. Shared by every implementation. */
fun checkPath(path: String): List<String> {
    val parts = if (path.isEmpty()) emptyList() else path.split('/')
    for (p in parts) require(SEGMENT.matches(p) && p != "..") { "unsafe sync path: $path" }
    return parts
}

/** Keeps everything in memory: tests, and the reference of how a transport behaves. */
class MemoryTransport : SyncTransport {
    private val files = LinkedHashMap<String, Pair<ByteArray, Int>>()
    private var counter = 0

    override suspend fun list(dir: String): List<TransportEntry> {
        val prefix = checkPath(dir).joinToString("/")
        val seen = LinkedHashMap<String, String>()
        for ((path, f) in files) {
            if (prefix.isNotEmpty() && !path.startsWith("$prefix/")) continue
            val rest = if (prefix.isNotEmpty()) path.substring(prefix.length + 1) else path
            seen[rest.substringBefore('/')] = if ('/' in rest) "dir" else f.second.toString()
        }
        return seen.map { TransportEntry(it.key, it.value) }
    }

    override suspend fun read(path: String): ByteArray? { checkPath(path); return files[path]?.first?.copyOf() }
    override suspend fun write(path: String, data: ByteArray) { checkPath(path); files[path] = data.copyOf() to ++counter }
    override suspend fun writeIfAbsent(path: String, data: ByteArray): Boolean {
        checkPath(path)
        if (path in files) return false
        write(path, data)
        return true
    }
    override suspend fun remove(path: String) { checkPath(path); files.remove(path) }
    override suspend fun exists(path: String): Boolean { checkPath(path); return path in files }
}

/** A folder on the device (Syncthing, a USB drive…) or, in tests, a directory shared with the TypeScript apps. */
class FolderTransport(private val root: String) : SyncTransport {
    private fun abs(path: String) = checkPath(path).fold(Path(root)) { p, s -> Path(p, s) }

    override suspend fun list(dir: String): List<TransportEntry> {
        val d = abs(dir)
        if (!SystemFileSystem.exists(d)) return emptyList()
        return SystemFileSystem.list(d).mapNotNull { p ->
            val name = p.name
            if (".tmp-" in name || !SEGMENT.matches(name)) return@mapNotNull null
            val meta = SystemFileSystem.metadataOrNull(p) ?: return@mapNotNull null
            // kotlinx-io exposes no modification time; size plus a content hash keeps unchanged files skippable.
            val version = if (meta.isDirectory) "dir" else "${meta.size}:${Hashing.sha256(readFile(p)).toHex().take(16)}"
            TransportEntry(name, version)
        }
    }

    private fun readFile(p: Path) = SystemFileSystem.source(p).buffered().use { it.readByteArray() }

    override suspend fun read(path: String): ByteArray? = abs(path).let { if (SystemFileSystem.exists(it)) readFile(it) else null }

    override suspend fun write(path: String, data: ByteArray) {
        val file = abs(path)
        file.parent?.let { SystemFileSystem.createDirectories(it) }
        val tmp = Path(file.parent!!, "${file.name}.tmp-${Random.nextInt(0, Int.MAX_VALUE).toString(16)}")
        SystemFileSystem.sink(tmp).buffered().use { it.write(data) }
        SystemFileSystem.atomicMove(tmp, file)
    }

    override suspend fun writeIfAbsent(path: String, data: ByteArray): Boolean {
        if (SystemFileSystem.exists(abs(path))) return false
        write(path, data)
        return true
    }

    override suspend fun remove(path: String) = SystemFileSystem.delete(abs(path), mustExist = false)
    override suspend fun exists(path: String) = SystemFileSystem.exists(abs(path))
}
