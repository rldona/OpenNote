package app.opennote.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The store on the bundled SQLite: the behaviour server/test/app.test.ts and store tests expect from the TypeScript one. */
class NoteStoreTest {
    private fun store() = NoteStore(Database.open(":memory:"), MemoryBlobStore())

    @Test
    fun notesNotebooksAndTags() {
        val s = store()
        assertEquals(listOf("Notes"), s.listNotebooks().map { it.name })
        val trips = s.createNotebook("Viajes", "Vida")
        val n = s.createNote(NoteInput(notebookId = trips.id, title = "Roma", content = "<p>Coliseo <b>y</b> café</p>", tags = listOf("viajes/italia", "fotos")))
        assertEquals("Coliseo y café", n.summary.snippet)
        assertEquals(listOf("fotos", "viajes/italia"), n.tags)
        val tags = s.listTags().associateBy { it.name }
        assertEquals(true, tags["viajes"]!!.virtual)
        assertEquals(1, tags["viajes"]!!.total)
        assertEquals(1, s.getNotebook(trips.id).noteCount)

        s.updateNote(n.id, NoteInput(content = "<p>Foro</p>"))
        assertEquals(1, s.listVersions(n.id).size)
        s.trashNote(n.id)
        assertTrue(s.listNotes().isEmpty())
        assertEquals(1, s.listNotes(ListFilter(trashed = true)).size)
        s.restoreNote(n.id)
        s.deleteNotePermanently(n.id)
        assertEquals(listOf(n.id), s.listTombstones().map { it.noteId })
        assertFailsWith<NotFoundError> { s.getNote(n.id) }
    }

    @Test
    fun searchOperators() {
        val s = store()
        val work = s.createNotebook("Trabajo")
        s.createNote(NoteInput(title = "Café en Lisboa", content = "<p>desayuno</p>", tags = listOf("viajes")))
        s.createNote(NoteInput(notebookId = work.id, title = "Reunión", content = "<p>Un café rápido con el equipo</p>", tags = listOf("trabajo/equipo")))
        val t = s.createNote(NoteInput(title = "Tareas", content = "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\" data-due=\"2026-11-02\"><p>Enviar acta</p></li></ul>"))
        fun q(query: String) = s.listNotes(ListFilter(q = query)).map { it.title }
        assertEquals(listOf("Café en Lisboa", "Reunión"), q("cafe")) // accents ignored, title hit first (bm25)
        assertEquals(listOf("Reunión"), q("cafe notebook:Trabajo"))
        assertEquals(listOf("Reunión"), q("tag:trabajo")) // a tag matches its descendants
        assertEquals(listOf("Café en Lisboa"), q("cafe -tag:trabajo"))
        assertEquals(listOf("Tareas"), q("todo:true"))
        assertEquals(listOf("Café en Lisboa"), q("intitle:cafe"))
        assertEquals(listOf("Reunión"), q("\"cafe rapido\""))

        val tasks = s.listTasks()
        assertEquals(listOf("Enviar acta"), tasks.map { it.text })
        assertEquals("2026-11-02", tasks.single().due)
        s.updateTask(t.id, 0, checked = true)
        assertTrue(s.listTasks().isEmpty())
        assertEquals(1, s.listTasks(NoteStore.TaskStatus.DONE).size)
    }

    @Test
    fun templatesAttachmentsAndDuplicates() {
        val s = store()
        val n = s.createNote(NoteInput(title = "Acta {{date}}", content = "<p>x</p>"))
        val att = s.addAttachment(n.id, "a.png", "image/png", byteArrayOf(1, 2, 3))
        s.updateNote(n.id, NoteInput(content = "<img src=\"/api/attachments/${att.id}\">"))
        assertEquals("5289df737df57326fcdd22597afb1fac", att.md5)
        val tpl = s.saveAsTemplate(n.id)
        assertEquals(listOf(tpl.id), s.listTemplates().map { it.id })
        val fromTpl = s.createFromTemplate(tpl.id)
        assertTrue(Regex("^Acta \\d{4}-\\d{2}-\\d{2}$").matches(fromTpl.title))
        val copy = s.listAttachments(fromTpl.id).single()
        assertTrue(copy.id != att.id && copy.id in fromTpl.content)
        assertEquals(listOf<Byte>(1, 2, 3), s.getAttachmentData(copy.id).toList())

        val sync = s.exportForSync(n.id)
        assertNotNull(sync)
        assertEquals(listOf(att.id), sync.attachments.map { it.id })
        assertNull(s.exportForSync("missing"))
    }

    @Test
    fun sanitizeKeepsCleanHtmlByteForByte() {
        val clean = "<p>Hola <strong>mundo</strong></p><ul data-type=\"taskList\"><li data-checked=\"false\" data-due=\"2026-11-02\" data-type=\"taskItem\"><label><input type=\"checkbox\"><span></span></label><div><p>x</p></div></li></ul>"
        assertEquals(clean, Html.sanitize(clean))
        val dirty = Html.sanitize("<p onclick=\"x()\">a</p><script>alert(1)</script><a href=\"javascript:x\">b</a>")
        assertTrue("onclick" !in dirty && "script" !in dirty && "javascript" !in dirty)
    }
}
