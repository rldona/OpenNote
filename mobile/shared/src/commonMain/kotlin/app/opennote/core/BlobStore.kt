package app.opennote.core

import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.readByteArray

/** Where attachment bytes live on this device (server/src/blobs.ts). Synchronous, like the store. */
interface BlobStore {
    fun put(id: String, data: ByteArray)
    fun get(id: String): ByteArray?
    fun has(id: String): Boolean
    fun delete(id: String)
}

class MemoryBlobStore : BlobStore {
    private val blobs = HashMap<String, ByteArray>()
    override fun put(id: String, data: ByteArray) { blobs[id] = data.copyOf() }
    override fun get(id: String) = blobs[id]?.copyOf()
    override fun has(id: String) = id in blobs
    override fun delete(id: String) { blobs.remove(id) }
}

/** One file per attachment id in a directory of the app's sandbox. */
class FileBlobStore(private val dir: String) : BlobStore {
    init { SystemFileSystem.createDirectories(Path(dir)) }

    private fun path(id: String): Path {
        // Ids are UUIDs this app or another OpenNote generated; anything else could point outside the directory.
        require(Regex("^[\\w-]{1,64}$").matches(id)) { "invalid attachment id" }
        return Path(dir, id)
    }

    override fun put(id: String, data: ByteArray) {
        val tmp = Path(dir, "$id.tmp")
        SystemFileSystem.sink(tmp).buffered().use { it.write(data) }
        SystemFileSystem.atomicMove(tmp, path(id))
    }

    override fun get(id: String): ByteArray? {
        val p = path(id)
        return if (SystemFileSystem.exists(p)) SystemFileSystem.source(p).buffered().use { it.readByteArray() } else null
    }

    override fun has(id: String) = SystemFileSystem.exists(path(id))
    override fun delete(id: String) = SystemFileSystem.delete(path(id), mustExist = false)
}
