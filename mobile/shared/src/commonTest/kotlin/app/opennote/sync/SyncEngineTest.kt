package app.opennote.sync

import app.opennote.core.Database
import app.opennote.core.ListFilter
import app.opennote.core.MemoryBlobStore
import app.opennote.core.NoteInput
import app.opennote.core.NoteStore
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/** The scenarios of server/test/sync.test.ts, on the Kotlin engine. */
class SyncEngineTest {
    private class Dev(val name: String, val transport: SyncTransport, passphrase: String? = null) {
        val store = NoteStore(Database.open(":memory:"), MemoryBlobStore())
        val engine = SyncEngine(store, { transport }, name, requireEncryption = false).also { it.setPassphrase(passphrase) }
        suspend fun sync() = engine.run()
        fun titles() = store.listNotes().map { it.title }.sorted()
        fun body(id: String) = store.getNote(id).content
    }

    @Test
    fun propagatesNotesWithNotebookTagsPinAndAttachments() = runTest {
        val t = MemoryTransport()
        val a = Dev("A", t); val b = Dev("B", t)
        val nb = a.store.createNotebook("Trips", "Life")
        val n = a.store.createNote(NoteInput(notebookId = nb.id, title = "Rome", content = "<p>Colosseum</p>", tags = listOf("travel/italy"), pinned = true))
        val att = a.store.addAttachment(n.id, "map.png", "image/png", byteArrayOf(1, 2, 3, 4))
        a.store.updateNote(n.id, NoteInput(content = "<p>Colosseum</p><img src=\"/api/attachments/${att.id}\">"))
        assertEquals(1, a.sync().pushed)
        assertEquals(1, b.sync().pulled)
        val got = b.store.getNote(n.id)
        assertEquals("Rome", got.title); assertTrue(got.summary.pinned); assertEquals(listOf("travel/italy"), got.tags)
        val book = b.store.listNotebooks().first { it.id == got.notebookId }
        assertEquals("Trips" to "Life", book.name to book.stack)
        assertEquals(listOf<Byte>(1, 2, 3, 4), b.store.attachmentData(att.id).toList())
        assertEquals(1, b.store.listNotes(ListFilter(q = "colosseum")).size)
        // Idempotent.
        val again = a.sync(); val againB = b.sync()
        assertEquals(0 to 0, again.pushed to again.pulled)
        assertEquals(0 to 0, againB.pushed to againB.pulled)
    }

    @Test
    fun editsTrashAndPermanentDeletion() = runTest {
        val t = MemoryTransport()
        val a = Dev("A", t); val b = Dev("B", t)
        val n = a.store.createNote(NoteInput(title = "doc", content = "<p>v1</p>"))
        a.sync(); b.sync()
        b.store.updateNote(n.id, NoteInput(content = "<p>v2 from B</p>"))
        b.sync(); a.sync()
        assertEquals("<p>v2 from B</p>", a.body(n.id))
        a.store.trashNote(n.id)
        a.sync(); b.sync()
        assertTrue(b.store.getNote(n.id).summary.trashedAt != null)
        b.store.deleteNotePermanently(n.id)
        b.sync()
        assertEquals(1, a.sync().deleted)
        a.sync(); b.sync()
        assertFalse(a.store.hasNote(n.id)); assertFalse(b.store.hasNote(n.id))
    }

    @Test
    fun keepsBothVersionsOnConcurrentEdits() = runTest {
        val t = MemoryTransport()
        val a = Dev("A", t); val b = Dev("B", t)
        val n = a.store.createNote(NoteInput(title = "plan", content = "<p>base</p>"))
        a.sync(); b.sync()
        a.store.updateNote(n.id, NoteInput(content = "<p>edit by A</p>", updatedAt = 2_000))
        b.store.updateNote(n.id, NoteInput(content = "<p>edit by B</p>", updatedAt = 3_000))
        a.sync()
        assertEquals(1, b.sync().conflicts.size)
        a.sync(); b.sync(); a.sync()
        for (d in listOf(a, b)) {
            assertEquals("<p>edit by B</p>", d.body(n.id))
            val copies = d.store.listNotes().filter { "conflict" in it.title }
            assertEquals(1, copies.size)
            assertTrue(Regex("^plan \\(conflict A \\d{4}-\\d{2}-\\d{2}\\)$").matches(copies[0].title))
            assertEquals("<p>edit by A</p>", d.body(copies[0].id))
        }
        assertEquals(a.titles(), b.titles())
        assertEquals(0, a.sync().conflicts.size + b.sync().conflicts.size)
    }

    @Test
    fun conflictCopiesCarryTheirOwnAttachments() = runTest {
        val t = MemoryTransport()
        val a = Dev("A", t); val b = Dev("B", t)
        val n = a.store.createNote(NoteInput(title = "pic", content = "<p>base</p>"))
        a.sync(); b.sync()
        val att = a.store.addAttachment(n.id, "a.png", "image/png", byteArrayOf(9, 9))
        a.store.updateNote(n.id, NoteInput(content = "<img src=\"/api/attachments/${att.id}\">", updatedAt = 2_000))
        b.store.updateNote(n.id, NoteInput(content = "<p>B wins</p>", updatedAt = 3_000))
        a.sync(); b.sync()
        val copy = b.store.listNotes().first { "conflict" in it.title }
        val copied = b.store.listAttachments(copy.id).single()
        assertNotEquals(att.id, copied.id)
        assertContains(b.body(copy.id), copied.id)
        assertEquals(listOf<Byte>(9, 9), b.store.attachmentData(copied.id).toList())
    }

    @Test
    fun anEditBeatsAConcurrentDeletion() = runTest {
        val t = MemoryTransport()
        val a = Dev("A", t); val b = Dev("B", t)
        val n = a.store.createNote(NoteInput(title = "keep me", content = "<p>x</p>"))
        a.sync(); b.sync()
        b.store.deleteNotePermanently(n.id)
        a.store.updateNote(n.id, NoteInput(content = "<p>edited</p>", updatedAt = 5_000))
        a.sync(); b.sync(); a.sync()
        assertEquals("<p>edited</p>", b.body(n.id))
        assertEquals("<p>edited</p>", a.body(n.id))
    }

    @Test
    fun threeDevicesConverge() = runTest {
        val t = MemoryTransport()
        val devs = listOf(Dev("A", t), Dev("B", t), Dev("C", t))
        devs.forEach { it.store.createNote(NoteInput(title = "from ${it.name}")) }
        repeat(2) { devs.forEach { it.sync() } }
        devs.forEach { assertEquals(listOf("from A", "from B", "from C"), it.titles()) }
    }

    @Test
    fun ignoresDamagedFilesAndWaitsForAttachmentBytes() = runTest {
        val t = MemoryTransport()
        val a = Dev("A", t)
        val n = a.store.createNote(NoteInput(title = "late", content = "<p>x</p>"))
        a.store.addAttachment(n.id, "f.bin", "application/octet-stream", byteArrayOf(7, 7, 7))
        a.sync()
        val path = "notes/${n.id}/${a.engine.deviceId}.json"
        val good = t.read(path)!!
        t.write(path, good.copyOfRange(0, good.size / 2)) // truncated, as a sync tool mid-transfer
        val b = Dev("B", t)
        assertTrue(b.sync().ok)
        assertFalse(b.store.hasNote(n.id))
        t.write(path, good)
        val blob = t.list("attachments").single().name
        val bytes = t.read("attachments/$blob")!!
        t.write("attachments/$blob", byteArrayOf(1)) // wrong content, still downloading
        b.sync()
        assertFalse(b.store.hasNote(n.id))
        t.write("attachments/$blob", bytes)
        b.sync()
        assertTrue(b.store.hasNote(n.id))
    }

    @Test
    fun encryptsWithAPassphrase() = runTest {
        val t = MemoryTransport()
        val a = Dev("A", t, "correct horse")
        val n = a.store.createNote(NoteInput(title = "Secret title", content = "<p>top secret body</p>"))
        a.store.addAttachment(n.id, "secret.txt", "text/plain", "plain attachment bytes".encodeToByteArray())
        assertEquals(1, a.sync().pushed)
        for (dir in listOf("notes/${n.id}", "attachments", "devices")) for (e in t.list(dir)) {
            val text = t.read("$dir/${e.name}")!!.decodeToString()
            assertFalse(listOf("Secret title", "top secret", "plain attachment", "secret.txt").any { it in text })
        }
        assertContains(Dev("B", t, "wrong").sync().errors.joinToString(), "wrong passphrase")
        assertContains(Dev("C", t).sync().errors.joinToString(), "encrypted")
        val d = Dev("D", t, "correct horse")
        assertEquals(1, d.sync().pulled)
        assertEquals("Secret title", d.store.getNote(n.id).title)
        assertEquals("plain attachment bytes", d.store.attachmentData(d.store.listAttachments(n.id).single().id).decodeToString())
    }

    @Test
    fun refusesWithoutAPassphraseWhenEncryptionIsRequired() = runTest {
        val store = NoteStore(Database.open(":memory:"), MemoryBlobStore())
        val engine = SyncEngine(store, { MemoryTransport() }, "phone", requireEncryption = true)
        kotlin.test.assertFailsWith<SyncError> { engine.run() }
    }
}
