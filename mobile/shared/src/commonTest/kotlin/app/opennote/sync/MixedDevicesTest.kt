package app.opennote.sync

import app.opennote.core.Database
import app.opennote.core.MemoryBlobStore
import app.opennote.core.NoteInput
import app.opennote.core.NoteStore
import app.opennote.core.SyncNote
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * A Kotlin device joins a location written by two TypeScript devices (the encrypted fixture), gets every note, edits, adds
 * and deletes, and syncs back. The result is left in build/sync-fixtures-kotlin, where server/test/sync-fixtures.test.ts
 * syncs a fresh TypeScript device from it and expects exactly the notes listed in its expected.json.
 */
class MixedDevicesTest {
    @Test
    fun aKotlinDeviceSyncsWithTypeScriptDevices() = runTest {
        val expected = readJsonObject("$FIXTURES/expected.json")
        val passphrase = expected["passphrase"]!!.jsonPrimitive.content
        val tsNotes = expected["locations"]!!.jsonObject["encrypted"]!!.jsonObject["notes"]!!.jsonArray.map { SyncNote.fromJson(it.jsonObject) }

        deleteRecursively(KOTLIN_LOCATION)
        copyRecursively("$FIXTURES/encrypted", "$KOTLIN_LOCATION/location")
        val store = NoteStore(Database.open(":memory:"), MemoryBlobStore())
        val engine = SyncEngine(store, { FolderTransport("$KOTLIN_LOCATION/location/opennote-sync") }, "Kotlin phone")
        engine.setPassphrase(passphrase)

        val first = engine.run()
        assertEquals(emptyList(), first.errors)
        assertEquals(tsNotes.size, first.pulled)
        fun mine() = store.syncNoteIds().mapNotNull(store::exportForSync).sortedBy { it.id }
        assertEquals(tsNotes.sortedBy { it.id }.map { it.toJson() }, mine().map { it.toJson() })
        // Nothing to push back: what it received is exactly what it holds.
        assertEquals(0, engine.run().pushed)

        // Edit, add (with an attachment) and delete, then sync back.
        val edited = tsNotes.first { it.title.startsWith("Plan") && "conflict" !in it.title }
        store.updateNote(edited.id, NoteInput(title = "Plan (editado en el móvil)", content = "<p>v3 desde Kotlin</p>"))
        val added = store.createNote(NoteInput(title = "Nota del móvil 📱", content = "<p>Hola desde Android/iOS</p>", tags = listOf("móvil")))
        val att = store.addAttachment(added.id, "foto.jpg", "image/jpeg", byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2, 3))
        store.updateNote(added.id, NoteInput(content = "<p>Hola</p><img src=\"/api/attachments/${att.id}\">"))
        val removed = tsNotes.first { it.title == "Borrador viejo" }
        store.deleteNotePermanently(removed.id)
        val second = engine.run()
        assertEquals(emptyList(), second.errors)
        assertEquals(3, second.pushed)

        val meta = JsonObject(mapOf("passphrase" to JsonPrimitive(passphrase), "notes" to JsonArray(mine().map { it.toJson() })))
        writeBytes("$KOTLIN_LOCATION/expected.json", jsStringify(meta).encodeToByteArray())
    }
}
