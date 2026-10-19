package app.opennote.ui

import app.opennote.core.Database
import app.opennote.core.FileBlobStore
import app.opennote.core.NoteStore
import app.opennote.sync.SyncEngine
import app.opennote.sync.SyncStatus
import app.opennote.sync.SyncTransport
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

/**
 * The app's access to its data. The store is synchronous and single-threaded, so every call runs on one background thread;
 * writes bump [revision], which screens watch to reload what they show.
 */
class Repo private constructor(private val store: NoteStore, private val transport: (() -> SyncTransport)?) {
    @OptIn(ExperimentalCoroutinesApi::class)
    private val io: CoroutineDispatcher = Dispatchers.Default.limitedParallelism(1)

    private val _revision = MutableStateFlow(0)
    val revision: StateFlow<Int> = _revision

    private val _sync = MutableStateFlow<SyncStatus?>(null)
    val syncStatus: StateFlow<SyncStatus?> = _sync

    val engine: SyncEngine? = transport?.let { SyncEngine(store, it, deviceModelName()) }

    suspend fun <T> read(block: NoteStore.() -> T): T = withContext(io) { store.block() }

    suspend fun <T> write(block: NoteStore.() -> T): T = withContext(io) { store.block() }.also { _revision.value++ }

    /** For callers that cannot suspend (the editor's WebView asking for an attachment on its own thread). */
    fun <T> blocking(block: NoteStore.() -> T): T = runBlocking(io) { store.block() }

    fun changed() { _revision.value++ }

    suspend fun sync(): SyncStatus? {
        val e = engine ?: return null
        val status = withContext(io) { runCatching { e.run() }.getOrElse { SyncStatus(ok = false, errors = listOf(it.message ?: "$it")) } }
        _sync.value = status
        _revision.value++
        return status
    }

    companion object {
        /** Opens (or creates) the database in the app's directory. Blocking: call it from a background coroutine. */
        suspend fun open(transport: (() -> SyncTransport)? = null): Repo = withContext(Dispatchers.Default) {
            val dir = appDataDir()
            val store = NoteStore(Database.open("$dir/opennote.db"), FileBlobStore("$dir/attachments"))
            Repo(store, transport)
        }

        /** An in-memory store, for previews and tests. */
        fun inMemory(): Repo = Repo(NoteStore(Database.open(":memory:"), app.opennote.core.MemoryBlobStore()), null)
    }
}
