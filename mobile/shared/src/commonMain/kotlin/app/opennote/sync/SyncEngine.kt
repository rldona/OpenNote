package app.opennote.sync

import app.opennote.core.NoteStore
import app.opennote.core.SyncNote
import dev.whyoleg.cryptography.random.CryptographyRandom
import kotlin.io.encoding.Base64
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

data class SyncConflict(val noteId: String, val title: String, val at: Long)

data class SyncStatus(
    val running: Boolean = false, val lastRunAt: Long? = null, val ok: Boolean = true, val pushed: Int = 0, val pulled: Int = 0,
    val deleted: Int = 0, val conflicts: List<SyncConflict> = emptyList(), val errors: List<String> = emptyList(),
)

/**
 * Serverless sync over any [SyncTransport], the Kotlin counterpart of server/src/sync.ts (same merge rules, same files:
 * docs/SYNC-FORMAT.md). Every device only writes its own files; version vectors tell "newer" from "edited concurrently",
 * and concurrent edits keep both versions.
 */
class SyncEngine(
    private val store: NoteStore,
    /** Where to sync: Google Drive on phones, a folder in tests. Called for every run. */
    private val transport: () -> SyncTransport,
    private val defaultDeviceName: String,
    /** Never write without a passphrase: a remote provider must only ever see ciphertext. */
    private val requireEncryption: Boolean = true,
    private val now: () -> Long = { Clock.System.now().toEpochMilliseconds() },
) {
    private var running = false
    private val cache = HashMap<String, Pair<String, JsonObject?>>()
    private var lastKey: Pair<String, ByteArray>? = null

    @OptIn(ExperimentalUuidApi::class)
    val deviceId: String
        get() = store.getMeta("device.id") ?: Uuid.random().toString().also { store.setMeta("device.id", it) }

    val deviceName: String get() = store.getMeta("device.name") ?: defaultDeviceName

    fun setPassphrase(passphrase: String?) = store.setMeta("sync.passphrase", passphrase?.ifEmpty { null })
    fun setDeviceName(name: String) { if (name.isNotBlank()) store.setMeta("device.name", name.trim().take(80)) }
    val hasPassphrase get() = store.getMeta("sync.passphrase") != null

    suspend fun run(): SyncStatus {
        if (running) return SyncStatus(running = true)
        if (requireEncryption && !hasPassphrase) throw SyncError("this destination only stores encrypted data: set a passphrase first")
        running = true
        val stats = Stats()
        var fatal: String? = null
        try {
            val t = transport()
            val codec = openRemote(t)
            syncAll(t, codec, stats)
        } catch (e: Throwable) {
            fatal = e.message ?: e.toString()
        } finally {
            running = false
        }
        return SyncStatus(
            lastRunAt = now(), ok = fatal == null && stats.errors.isEmpty(), pushed = stats.pushed, pulled = stats.pulled,
            deleted = stats.deleted, conflicts = stats.conflicts.toList(), errors = listOfNotNull(fatal) + stats.errors,
        )
    }

    private class Stats {
        var pushed = 0; var pulled = 0; var deleted = 0
        val conflicts = mutableListOf<SyncConflict>()
        val errors = mutableListOf<String>()
    }

    private fun deriveKey(passphrase: String, salt: ByteArray): ByteArray {
        val id = "${Base64.encode(salt)}:$passphrase"
        lastKey?.let { if (it.first == id) return it.second }
        return SyncCodec.deriveKey(passphrase, salt).also { lastKey = id to it }
    }

    /** Creates the remote structure on first use and returns the codec matching it (docs/SYNC-FORMAT.md 2). */
    private suspend fun openRemote(t: SyncTransport): SyncCodec {
        val passphrase = store.getMeta("sync.passphrase")
        if (!t.exists("format.json")) {
            val salt = CryptographyRandom.nextBytes(16)
            val codec = SyncCodec(passphrase?.let { deriveKey(it, salt) })
            val format = buildJsonObject {
                put("version", SyncFormat.VERSION)
                put("app", "opennote")
                put("encrypted", passphrase != null)
                if (passphrase != null) {
                    put("salt", Base64.encode(salt))
                    put("verifier", Base64.encode(codec.encode("opennote".encodeToByteArray())))
                }
            }
            t.writeIfAbsent("format.json", jsStringify(format).encodeToByteArray())
        }
        val format = t.read("format.json")?.decodeToString()?.let { runCatching { parseJson(it).jsonObject }.getOrNull() } ?: JsonObject(emptyMap())
        val version = (format["version"] as? JsonPrimitive)?.content?.toIntOrNull()
            ?: throw SyncError("the sync location has no readable format file yet; try again in a moment")
        if (version > SyncFormat.VERSION) throw SyncError("the sync location was written by a newer OpenNote version")
        val encrypted = (format["encrypted"] as? JsonPrimitive)?.booleanOrNull == true
        if (!encrypted) {
            if (passphrase != null) throw SyncError("this sync location is not encrypted; remove the passphrase or use a new location")
            return SyncCodec(null)
        }
        if (passphrase == null) throw SyncError("this sync location is encrypted: enter its passphrase")
        val codec = SyncCodec(deriveKey(passphrase, Base64.decode(format["salt"]!!.jsonPrimitive.content)))
        val check = try { codec.decode(Base64.decode(format["verifier"]!!.jsonPrimitive.content)) } catch (_: SyncError) { null }
        if (check == null || !constantTimeEquals(check, "opennote".encodeToByteArray())) throw SyncError("wrong passphrase")
        return codec
    }

    private fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].toInt() xor b[i].toInt())
        return diff == 0
    }

    // ------------------------------------------------------------ records on disk

    private suspend fun readRecord(t: SyncTransport, path: String, version: String, codec: SyncCodec): JsonObject? {
        cache[path]?.let { if (it.first == version) return it.second }
        val raw = t.read(path) ?: return null
        val rec = try {
            parseJson(codec.decode(raw).decodeToString()).jsonObject.takeIf { SyncFormat.isValidRecord(it, path) }
        } catch (e: SyncError) {
            if ("passphrase" in (e.message ?: "")) throw e
            null // half-synced or damaged: read again next run
        } catch (_: Exception) {
            null
        }
        cache[path] = version to rec
        return rec
    }

    private suspend fun writeRecord(t: SyncTransport, codec: SyncCodec, id: String, vv: Map<String, Long>, note: SyncNote?) {
        val me = deviceId
        val fields = linkedMapOf<String, JsonElement>(
            "v" to JsonPrimitive(SyncFormat.VERSION), "id" to JsonPrimitive(id), "deviceId" to JsonPrimitive(me),
            "deviceName" to JsonPrimitive(deviceName), "vv" to JsonObject(vv.mapValues { JsonPrimitive(it.value) }),
            "writtenAt" to JsonPrimitive(now()),
        )
        if (note == null) fields["deleted"] = JsonPrimitive(true) else fields["note"] = note.toJson()
        t.write("notes/$id/$me.json", codec.encode(SyncFormat.sealRecord(JsonObject(fields))))
    }

    private suspend fun readNote(t: SyncTransport, id: String, codec: SyncCodec): List<JsonObject> =
        t.list("notes/$id").mapNotNull { (f, version) ->
            if (!f.endsWith(".json") || !SyncFormat.DEVICE_ID.matches(f.dropLast(5))) return@mapNotNull null
            readRecord(t, "notes/$id/$f", version, codec)
        }

    private suspend fun ensureBlob(t: SyncTransport, codec: SyncCodec, sha256: String, attachmentId: String) {
        val path = "attachments/${codec.blobName(sha256)}"
        if (!t.exists(path)) t.write(path, codec.encode(store.attachmentData(attachmentId)))
    }

    /** Bytes of the attachments of [note] this device lacks, or null while some are still on their way. */
    private suspend fun readBlobs(t: SyncTransport, codec: SyncCodec, note: SyncNote): Map<String, ByteArray>? {
        val out = HashMap<String, ByteArray>()
        for (a in note.attachments) {
            if (store.hasAttachment(a.id)) continue
            if (!SyncFormat.BLOB_NAME.matches(a.sha256)) return null
            val data = try { t.read("attachments/${codec.blobName(a.sha256)}")?.let(codec::decode) } catch (_: Exception) { null } ?: return null
            if (Hashing.sha256(data).toHex() != a.sha256) return null
            out[a.id] = data
        }
        return out
    }

    // --------------------------------------------------------------------- merge

    private suspend fun syncAll(t: SyncTransport, codec: SyncCodec, stats: Stats) {
        val me = deviceId
        val device = buildJsonObject { put("id", me); put("name", deviceName); put("lastSeenAt", now()) }
        t.write("devices/$me.json", codec.encode(jsStringify(device).encodeToByteArray()))
        val remoteIds = t.list("notes").map { it.name }.filter { SyncFormat.NOTE_ID.matches(it) }
        val done = HashSet<String>()
        // A second pass picks up notes created during the first one (conflict copies).
        repeat(3) {
            val ids = LinkedHashSet<String>().apply { addAll(store.syncNoteIds()); addAll(remoteIds); addAll(store.listTombstones().map { it.noteId }) }
            val todo = ids.filter { it !in done }
            if (todo.isEmpty()) return@repeat
            for (id in todo) {
                done += id
                try {
                    syncNote(t, codec, id, stats)
                } catch (e: SyncError) {
                    throw e
                } catch (e: Exception) {
                    stats.errors += "$id: ${e.message ?: e}"
                }
            }
        }
        collectGarbage(t)
    }

    private fun vvOf(rec: JsonObject): Map<String, Long> = rec["vv"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long }
    private fun noteOf(rec: JsonObject): SyncNote? = (rec["note"] as? JsonObject)?.let(SyncNote::fromJson)
    private fun isDeleted(rec: JsonObject) = (rec["deleted"] as? JsonPrimitive)?.booleanOrNull == true
    private fun deviceOf(rec: JsonObject) = rec["deviceId"]!!.jsonPrimitive.content
    private fun hashOf(n: SyncNote) = SyncFormat.noteHash(n.toJson())

    private fun compare(a: Map<String, Long>, b: Map<String, Long>) = SyncFormat.compareVV(
        JsonObject(a.mapValues { JsonPrimitive(it.value) }), JsonObject(b.mapValues { JsonPrimitive(it.value) }),
    )

    private fun maxVV(vararg all: Map<String, Long>): Map<String, Long> {
        val out = LinkedHashMap<String, Long>()
        for (v in all) for ((k, n) in v) out[k] = maxOf(out[k] ?: 0, n)
        return out
    }

    private suspend fun syncNote(t: SyncTransport, codec: SyncCodec, id: String, stats: Stats) {
        val me = deviceId
        val all = readNote(t, id, codec)
        val own = all.firstOrNull { deviceOf(it) == me }
        // Records no other record supersedes. Ours is handled separately.
        val frontier = all.filter { r -> deviceOf(r) != me && all.none { o -> o !== r && compare(vvOf(o), vvOf(r)) == SyncFormat.Order.AFTER } }

        val state = store.getSyncState(id)
        val tomb = store.listTombstones().firstOrNull { it.noteId == id }
        var base: Map<String, Long> = state?.vv ?: emptyMap()
        var local = if (tomb != null) null else store.exportForSync(id)
        val localHash = local?.let(::hashOf)
        val localChanged = local != null && (state == null || state.hash != localHash)
        var needPush = localChanged

        // ---- pull: remote records not seen yet
        val fresh = frontier.filter { r -> compare(base, vvOf(r)).let { it != SyncFormat.Order.AFTER && it != SyncFormat.Order.EQUAL } }
        if (fresh.isNotEmpty()) {
            val live = fresh.filter { !isDeleted(it) && it["note"] != null }
            val winner = live.sortedWith { x, y ->
                val ux = noteOf(x)!!.updatedAt; val uy = noteOf(y)!!.updatedAt
                if (ux != uy) uy.compareTo(ux) else deviceOf(y).compareTo(deviceOf(x))
            }.firstOrNull()
            val remoteVV = maxVV(*fresh.map(::vvOf).toTypedArray())

            // Several devices edited concurrently: the losers are kept as conflict copies.
            if (winner != null) for (loser in live) {
                if (loser !== winner && hashOf(noteOf(loser)!!) != hashOf(noteOf(winner)!!)) keepConflictCopy(loser, noteOf(loser)!!, stats, t, codec)
            }

            if (winner == null) {
                // Only deletions are new.
                if (local != null && !localChanged) {
                    store.deleteForSync(id)
                    store.deleteSyncState(id)
                    if (own != null) t.remove("notes/$id/$me.json")
                    stats.deleted++
                    return
                }
                if (local == null && tomb == null) {
                    store.setSyncState(id, remoteVV, "deleted") // nothing to delete; remember we saw it
                    return
                }
                // Edit beats delete: keep the local note (or our own deletion) and supersede the remote deletion.
                base = maxVV(base, remoteVV)
                needPush = true
            } else {
                val winnerNote = noteOf(winner)!!
                val blobs = readBlobs(t, codec, winnerNote) ?: return // attachments still syncing: next run
                base = maxVV(base, remoteVV)
                if (local == null) {
                    // Unknown here, or deleted here but edited elsewhere (edit wins).
                    store.applyFromSync(winnerNote, blobs)
                    store.removeTombstone(id)
                    stats.pulled++
                    needPush = false
                } else if (hashOf(winnerNote) == localHash) {
                    needPush = false // same content: only the clocks need merging
                } else if (!localChanged) {
                    store.applyFromSync(winnerNote, blobs)
                    stats.pulled++
                    needPush = false
                } else {
                    // Both sides edited: the newest wins, the other version survives as a conflict copy.
                    val localWins = local.updatedAt > winnerNote.updatedAt || (local.updatedAt == winnerNote.updatedAt && me > deviceOf(winner))
                    if (localWins) {
                        keepConflictCopy(winner, winnerNote, stats, t, codec)
                        needPush = true
                    } else {
                        val mine = JsonObject(winner + mapOf("deviceId" to JsonPrimitive(me), "deviceName" to JsonPrimitive(deviceName)))
                        keepConflictCopy(mine, local, stats, t, codec)
                        store.applyFromSync(winnerNote, blobs)
                        stats.pulled++
                        needPush = false
                    }
                }
                local = store.exportForSync(id)
                store.setSyncState(id, base, local?.let(::hashOf) ?: "deleted")
                if (!needPush) return
            }
        }

        // ---- push: local edits and local deletions
        if (tomb != null && !store.hasNote(id)) {
            if (state == null && own == null) {
                store.removeTombstone(id) // never left this device
                return
            }
            if (!tomb.pushed || needPush || (own != null && !isDeleted(own))) {
                val vv = base + (me to maxOf(base[me] ?: 0, own?.let { vvOf(it)[me] } ?: 0) + 1)
                writeRecord(t, codec, id, vv, null)
                store.setSyncState(id, vv, "deleted")
                store.markTombstonePushed(id)
                stats.pushed++
            }
            return
        }

        if (!needPush || local == null) return
        for (a in local.attachments) ensureBlob(t, codec, a.sha256, a.id)
        val vv = base + (me to maxOf(base[me] ?: 0, own?.let { vvOf(it)[me] } ?: 0) + 1)
        writeRecord(t, codec, id, vv, local)
        store.setSyncState(id, vv, hashOf(local))
        stats.pushed++
    }

    /** Bytes of an attachment: from this device if present, otherwise from the sync location. */
    private suspend fun blobFor(t: SyncTransport, codec: SyncCodec, a: SyncNote.SyncAttachment): ByteArray? {
        if (store.hasAttachment(a.id)) return store.attachmentData(a.id)
        return try {
            t.read("attachments/${codec.blobName(a.sha256)}")?.let(codec::decode)?.takeIf { Hashing.sha256(it).toHex() == a.sha256 }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Saves a losing version as a new note. Its id, title and attachment ids come from the loser only, so every device
     * builds exactly the same copy (docs/SYNC-FORMAT.md 3.6).
     */
    private suspend fun keepConflictCopy(loser: JsonObject, n: SyncNote, stats: Stats, t: SyncTransport, codec: SyncCodec) {
        val copyId = SyncFormat.derivedId("conflict:${loser["id"]!!.jsonPrimitive.content}:${deviceOf(loser)}:${hashOf(n)}")
        if (store.hasNote(copyId)) return
        val day = Instant.fromEpochMilliseconds(n.updatedAt).toLocalDateTime(TimeZone.UTC).date.toString()
        val title = "${n.title.ifEmpty { "Untitled" }} (conflict ${loser["deviceName"]!!.jsonPrimitive.content} $day)"
        var content = n.content
        val attachments = mutableListOf<SyncNote.SyncAttachment>()
        val blobs = HashMap<String, ByteArray>()
        for (a in n.attachments) {
            val data = blobFor(t, codec, a) ?: continue
            val newId = SyncFormat.derivedId("$copyId:${a.id}")
            content = content.replace("/api/attachments/${a.id}", "/api/attachments/$newId")
            attachments += a.copy(id = newId)
            blobs[newId] = data
        }
        store.applyFromSync(n.copy(id = copyId, title = title, content = content, pinned = false, reminderAt = null, attachments = attachments), blobs)
        stats.conflicts += SyncConflict(copyId, title, now())
    }

    /** Our own tombstone files older than 90 days are removed. */
    private suspend fun collectGarbage(t: SyncTransport) {
        val me = deviceId
        for (tomb in store.listTombstones()) {
            if (!tomb.pushed || now() - tomb.deletedAt < TOMBSTONE_TTL_MS) continue
            t.remove("notes/${tomb.noteId}/$me.json")
            store.removeTombstone(tomb.noteId)
            store.deleteSyncState(tomb.noteId)
        }
    }

    private companion object {
        const val TOMBSTONE_TTL_MS = 90L * 24 * 60 * 60 * 1000
    }
}
