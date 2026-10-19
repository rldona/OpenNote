package app.opennote.ui

import app.opennote.core.Database
import app.opennote.core.FileBlobStore
import app.opennote.core.NoteStore
import app.opennote.sync.SecretStore
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
class Repo private constructor(private val store: NoteStore, transport: (() -> SyncTransport)?, secrets: SecretStore?) {
    @OptIn(ExperimentalCoroutinesApi::class)
    private val io: CoroutineDispatcher = Dispatchers.Default.limitedParallelism(1)

    private val _revision = MutableStateFlow(0)
    val revision: StateFlow<Int> = _revision

    /** Changes made on this device (not those a sync brings): they schedule the next sync. */
    private val _edits = MutableStateFlow(0)
    val edits: StateFlow<Int> = _edits

    private val _sync = MutableStateFlow<SyncStatus?>(null)
    val syncStatus: StateFlow<SyncStatus?> = _sync

    private val _syncing = MutableStateFlow(false)
    val syncing: StateFlow<Boolean> = _syncing

    val engine: SyncEngine? = transport?.let {
        if (secrets == null) SyncEngine(store, it, deviceModelName()) else SyncEngine(store, it, deviceModelName(), secrets = secrets)
    }

    suspend fun <T> read(block: NoteStore.() -> T): T = withContext(io) { store.block() }

    suspend fun <T> write(block: NoteStore.() -> T): T = withContext(io) { store.block() }.also { _revision.value++; _edits.value++ }

    /** For callers that cannot suspend (the editor's WebView asking for an attachment on its own thread). */
    fun <T> blocking(block: NoteStore.() -> T): T = runBlocking(io) { store.block() }

    fun changed() { _revision.value++ }

    suspend fun sync(): SyncStatus? {
        val e = engine ?: return null
        _syncing.value = true
        val status = try {
            withContext(io) { runCatching { e.run() }.getOrElse { SyncStatus(ok = false, errors = listOf(it.message ?: "$it")) } }
        } finally {
            _syncing.value = false
        }
        if (status.running) return null // another run was under way
        _sync.value = status
        _revision.value++
        return status
    }

    companion object {
        /** Opens (or creates) the database in the app's directory, syncing through [transport] with [secrets] kept apart. */
        suspend fun open(secrets: SecretStore? = null, transport: (() -> SyncTransport)? = null): Repo = withContext(Dispatchers.Default) {
            val dir = appDataDir()
            val store = NoteStore(Database.open("$dir/opennote.db"), FileBlobStore("$dir/attachments"))
            // Builds before the Keychain/Keystore kept the passphrase in the database: move it out.
            if (secrets != null) store.getMeta("sync.passphrase")?.let { p ->
                if (runCatching { secrets.set("sync.passphrase", p) }.isSuccess) store.setMeta("sync.passphrase", null)
            }
            Repo(store, transport, secrets)
        }

        /** An in-memory store, for previews and tests. */
        fun inMemory(): Repo = Repo(NoteStore(Database.open(":memory:"), app.opennote.core.MemoryBlobStore()), null, null)
    }
}
