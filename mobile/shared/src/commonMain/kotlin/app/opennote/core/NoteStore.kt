package app.opennote.core

import app.opennote.sync.Hashing
import app.opennote.sync.toHex
import kotlin.time.Clock
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/**
 * Notes, notebooks, tags, tasks, templates, versions, attachments and the sync bookkeeping, over the same schema as the
 * TypeScript store (server/src/store.ts, which this mirrors method by method). Synchronous: call it off the main thread.
 */
class NoteStore(private val db: Database, private val blobs: BlobStore, private val now: () -> Long = { Clock.System.now().toEpochMilliseconds() }) {
    private val attachmentListeners = mutableListOf<(String) -> Unit>()

    /** Called with the id of every attachment created here or arriving through sync. */
    fun onAttachmentAdded(listener: (String) -> Unit) { attachmentListeners += listener }

    fun close() = db.close()

    private fun count(table: String) = db.one("SELECT COUNT(*) AS n FROM $table")!!["n"] as Long

    private var txDepth = 0

    // After every property above: the first start creates the default notebook and indexes old tasks.
    init {
        if (count("notebooks") == 0L) createNotebook("Notes")
        backfillTasks()
        db.exec("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)")
    }

    /** Runs [fn] atomically; nested calls join the outer transaction. */
    fun <T> tx(fn: () -> T): T {
        if (txDepth > 0) return fn()
        db.exec("BEGIN")
        txDepth = 1
        try {
            val r = fn()
            db.exec("COMMIT")
            return r
        } catch (e: Throwable) {
            db.exec("ROLLBACK")
            throw e
        } finally {
            txDepth = 0
        }
    }

    // ------------------------------------------------------------------ notebooks

    fun listNotebooks(): List<Notebook> = db.all("$notebookSelect ORDER BY COALESCE(nb.stack, ''), nb.name COLLATE NOCASE").map(::toNotebook)

    fun getNotebook(id: String): Notebook = db.one("$notebookSelect WHERE id = ?", id)?.let(::toNotebook) ?: throw NotFoundError("notebook not found")

    fun createNotebook(name: String, stack: String? = null): Notebook {
        val n = name.trim()
        if (n.isEmpty()) throw ValidationError("name is required")
        val id = newId()
        db.run("INSERT INTO notebooks (id, name, stack, created_at) VALUES (?, ?, ?, ?)", id, n, stack?.trim()?.ifEmpty { null }, now())
        return getNotebook(id)
    }

    fun findOrCreateNotebook(name: String, stack: String? = null): Notebook =
        db.one("SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE", name)?.let { getNotebook(it["id"] as String) } ?: createNotebook(name, stack)

    fun updateNotebook(id: String, name: String? = null, stack: String? = null, clearStack: Boolean = false): Notebook {
        val current = getNotebook(id)
        val n = name?.trim() ?: current.name
        if (n.isEmpty()) throw ValidationError("name is required")
        val s = if (clearStack) null else stack?.trim()?.ifEmpty { null } ?: current.stack
        db.run("UPDATE notebooks SET name = ?, stack = ? WHERE id = ?", n, s, id)
        return getNotebook(id)
    }

    /** Moves the notebook's notes to [moveTo] (default: the first remaining notebook), then deletes it. */
    fun deleteNotebook(id: String, moveTo: String? = null) {
        getNotebook(id)
        val others = listNotebooks().filter { it.id != id }
        if (others.isEmpty()) throw ValidationError("cannot delete the last notebook")
        val target = moveTo ?: others.first().id
        if (target == id || others.none { it.id == target }) throw ValidationError("invalid target notebook")
        tx {
            db.run("UPDATE notes SET notebook_id = ? WHERE notebook_id = ?", target, id)
            db.run("DELETE FROM notebooks WHERE id = ?", id)
        }
    }

    // ---------------------------------------------------------------------- notes

    private fun defaultNotebookId() = listNotebooks().first().id

    fun createNote(input: NoteInput = NoteInput()): Note {
        val id = newId()
        val t = now()
        val notebookId = input.notebookId ?: defaultNotebookId()
        getNotebook(notebookId)
        val content = input.content ?: ""
        tx {
            db.run(
                """INSERT INTO notes (id, notebook_id, title, content, text, pinned, reminder_at, source_url, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                id, notebookId, input.title ?: "", content, Html.toText(content), input.pinned == true, input.reminderAt,
                input.sourceUrl, input.createdAt ?: t, input.updatedAt ?: input.createdAt ?: t,
            )
            input.tags?.let { setTags(id, it) }
            reindex(id)
        }
        return getNote(id)
    }

    fun getNote(id: String): Note {
        val row = db.one("SELECT * FROM notes WHERE id = ?", id) ?: throw NotFoundError("note not found")
        return Note(toSummary(row), row["content"] as String, row["source_url"] as String?)
    }

    fun updateNote(id: String, patch: NoteInput): Note {
        val current = getNote(id)
        val title = patch.title ?: current.title
        val content = patch.content ?: current.content
        val notebookId = patch.notebookId ?: current.notebookId
        patch.notebookId?.let { getNotebook(it) }
        val contentChanged = title != current.title || content != current.content
        tx {
            if (contentChanged) snapshotVersion(current)
            val text = if (contentChanged) Html.toText(content) else db.one("SELECT text FROM notes WHERE id = ?", id)!!["text"]
            db.run(
                """UPDATE notes SET notebook_id = ?, title = ?, content = ?, text = ?, pinned = ?, reminder_at = ?, source_url = ?,
                   updated_at = ? WHERE id = ?""",
                notebookId, title, content, text, patch.pinned ?: current.summary.pinned,
                if (patch.clearReminder) null else patch.reminderAt ?: current.summary.reminderAt,
                if (patch.clearSourceUrl) null else patch.sourceUrl ?: current.sourceUrl,
                patch.updatedAt ?: if (contentChanged || patch.notebookId != null) now() else current.summary.updatedAt,
                id,
            )
            patch.tags?.let { setTags(id, it) }
            reindex(id)
        }
        return getNote(id)
    }

    fun trashNote(id: String) {
        getNote(id)
        db.run("UPDATE notes SET trashed_at = ? WHERE id = ?", now(), id)
    }

    fun restoreNote(id: String): Note {
        getNote(id)
        db.run("UPDATE notes SET trashed_at = NULL WHERE id = ?", id)
        return getNote(id)
    }

    fun deleteNotePermanently(id: String) = purgeNote(id, tombstone = true)

    private fun purgeNote(id: String, tombstone: Boolean) {
        getNote(id)
        val files = listAttachments(id)
        tx {
            db.run("DELETE FROM notes_fts WHERE note_id = ?", id)
            db.run("DELETE FROM notes WHERE id = ?", id)
            db.exec("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)")
            if (tombstone) db.run("INSERT OR REPLACE INTO sync_tombstones (note_id, deleted_at, pushed) VALUES (?, ?, 0)", id, now())
        }
        for (a in files) removeBlobIfOrphan(a.id)
    }

    fun emptyTrash(): Int {
        val ids = db.all("SELECT id FROM notes WHERE trashed_at IS NOT NULL").map { it["id"] as String }
        ids.forEach(::deleteNotePermanently)
        return ids.size
    }

    fun listNotes(filter: ListFilter = ListFilter()): List<NoteSummary> {
        val where = mutableListOf<String>()
        val params = mutableListOf<Any?>()
        var join = ""
        val parsed = filter.q?.takeIf { it.isNotBlank() }?.let { SearchQuery.parse(it) }

        where += if (filter.trashed) "n.trashed_at IS NOT NULL" else "n.trashed_at IS NULL"
        where += if (filter.templates) "n.is_template > 0" else "n.is_template = 0"
        filter.notebookId?.let { where += "n.notebook_id = ?"; params += it }
        if (filter.pinned) where += "n.pinned = 1"
        if (filter.reminders) where += "n.reminder_at IS NOT NULL"

        // A tag also matches its descendants: tag:work finds work/projects/alpha.
        fun tagExists(negate: Boolean) =
            "${if (negate) "NOT " else ""}EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id AND (t.name = ? COLLATE NOCASE OR t.name LIKE ? ESCAPE '\\'))"
        for (tag in listOfNotNull(filter.tag) + (parsed?.tags ?: emptyList())) { where += tagExists(false); params += tag; params += "${likeEscape(tag)}/%" }
        for (tag in parsed?.notTags ?: emptyList()) { where += tagExists(true); params += tag; params += "${likeEscape(tag)}/%" }
        for (nb in parsed?.notebooks ?: emptyList()) { where += "n.notebook_id IN (SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE)"; params += nb }
        for (nb in parsed?.notNotebooks ?: emptyList()) { where += "n.notebook_id NOT IN (SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE)"; params += nb }
        parsed?.hasAttachment?.let { where += "${if (it) "" else "NOT "}EXISTS (SELECT 1 FROM attachments a WHERE a.note_id = n.id)" }
        parsed?.hasReminder?.let { where += if (it) "n.reminder_at IS NOT NULL" else "n.reminder_at IS NULL" }
        when (parsed?.todo) {
            true -> where += "n.content LIKE '%data-checked=\"false\"%'"
            false -> where += "n.content LIKE '%data-type=\"taskItem\"%' AND n.content NOT LIKE '%data-checked=\"false\"%'"
            null -> Unit
        }
        if (parsed != null) for ((col, range) in listOf("n.created_at" to parsed.created, "n.updated_at" to parsed.updated)) {
            range.after?.let { where += "$col >= ?"; params += it }
            range.before?.let { where += "$col < ?"; params += it }
        }
        for (src in parsed?.sourceUrl ?: emptyList()) { where += "n.source_url LIKE ? ESCAPE '\\'"; params += "%${likeEscape(src)}%" }
        parsed?.match?.let { join = "JOIN notes_fts f ON f.note_id = n.id"; where += "notes_fts MATCH ?"; params += it }
        parsed?.exclude?.let { where += "n.id NOT IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?)"; params += it }

        val order = if (parsed?.match != null) "n.pinned DESC, bm25(notes_fts, 0, 5, 1), n.updated_at DESC" else "n.pinned DESC, n.updated_at DESC"
        params += minOf(filter.limit, 5000)
        return db.all("SELECT n.* FROM notes n $join WHERE ${where.joinToString(" AND ")} ORDER BY $order LIMIT ?", *params.toTypedArray()).map(::toSummary)
    }

    private fun toSummary(row: Row): NoteSummary {
        val id = row["id"] as String
        val tags = db.all("SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name COLLATE NOCASE", id).map { it["name"] as String }
        val attachments = db.one("SELECT COUNT(*) AS n FROM attachments WHERE note_id = ?", id)!!["n"] as Long
        return NoteSummary(
            id = id, notebookId = row["notebook_id"] as String, title = row["title"] as String, snippet = Html.snippet(row["text"] as String),
            pinned = row["pinned"] == 1L, trashedAt = row["trashed_at"] as Long?, reminderAt = row["reminder_at"] as Long?,
            createdAt = row["created_at"] as Long, updatedAt = row["updated_at"] as Long, tags = tags, attachmentCount = attachments.toInt(),
        )
    }

    private fun reindex(id: String) {
        val row = db.one("SELECT title, text FROM notes WHERE id = ?", id)!!
        val fromFiles = db.all(
            "SELECT t.text FROM attachment_text t JOIN attachments a ON a.id = t.attachment_id WHERE a.note_id = ? AND t.text != '' ORDER BY a.created_at", id,
        ).map { it["text"] as String }
        db.run("DELETE FROM notes_fts WHERE note_id = ?", id)
        db.run("INSERT INTO notes_fts (note_id, title, body) VALUES (?, ?, ?)", id, row["title"], (listOf(row["text"] as String) + fromFiles).joinToString("\n"))
        syncTasks(id)
    }

    // ---------------------------------------------------------------------- tasks

    private fun syncTasks(noteId: String) {
        val content = db.one("SELECT content FROM notes WHERE id = ?", noteId)!!["content"] as String
        db.run("DELETE FROM tasks WHERE note_id = ?", noteId)
        for (t in Html.extractTasks(content)) db.run("INSERT INTO tasks (note_id, idx, text, checked, due) VALUES (?, ?, ?, ?, ?)", noteId, t.idx, t.text, t.checked, t.due)
    }

    private fun backfillTasks() {
        val version = db.one("PRAGMA user_version")!!["user_version"] as Long
        if (version >= 1) return
        val ids = db.all("SELECT id FROM notes").map { it["id"] as String }
        tx { ids.forEach(::syncTasks) }
        db.exec("PRAGMA user_version = 1")
    }

    private fun localDay(offsetDays: Int = 0): String {
        val zone = TimeZone.currentSystemDefault()
        val d = kotlin.time.Instant.fromEpochMilliseconds(now()).toLocalDateTime(zone).date.plus(offsetDays, DateTimeUnit.DAY)
        return d.toString()
    }

    enum class TaskStatus { OPEN, DONE, ALL }
    enum class TaskDue { OVERDUE, TODAY, WEEK, NONE, ANY }

    fun listTasks(status: TaskStatus = TaskStatus.OPEN, due: TaskDue? = null): List<Task> {
        val where = mutableListOf("n.trashed_at IS NULL", "n.is_template = 0")
        val params = mutableListOf<Any?>()
        if (status != TaskStatus.ALL) where += "t.checked = ${if (status == TaskStatus.DONE) 1 else 0}"
        val today = localDay()
        when (due) {
            TaskDue.OVERDUE -> { where += "t.due < ?"; params += today }
            TaskDue.TODAY -> { where += "t.due = ?"; params += today }
            TaskDue.WEEK -> { where += "t.due >= ? AND t.due <= ?"; params += today; params += localDay(7) }
            TaskDue.NONE -> where += "t.due IS NULL"
            TaskDue.ANY -> where += "t.due IS NOT NULL"
            null -> Unit
        }
        return db.all(
            """SELECT t.*, n.title, n.notebook_id FROM tasks t JOIN notes n ON n.id = t.note_id WHERE ${where.joinToString(" AND ")}
               ORDER BY t.due IS NULL, t.due, n.updated_at DESC, t.idx LIMIT 2000""",
            *params.toTypedArray(),
        ).map { r ->
            Task(r["note_id"] as String, r["title"] as String, r["notebook_id"] as String, (r["idx"] as Long).toInt(), r["text"] as String, r["checked"] == 1L, r["due"] as String?)
        }
    }

    /** Checks or unchecks a task, or changes its due date, by rewriting the note's checklist item. */
    fun updateTask(noteId: String, idx: Int, checked: Boolean? = null, due: String? = null, clearDue: Boolean = false): Note {
        if (due != null && !Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(due)) throw ValidationError("due must be YYYY-MM-DD")
        val note = getNote(noteId)
        val html = Html.patchTaskItem(note.content, idx, checked, due, clearDue) ?: throw NotFoundError("task not found")
        return updateNote(noteId, NoteInput(content = html))
    }

    // ----------------------------------------------------------------------- tags

    /** Hierarchical tags (a/b/c); ancestors no note uses directly come back as `virtual`. */
    fun listTags(): List<TagCount> {
        val rows = db.all(
            """SELECT t.name AS name, n.id AS note_id FROM tags t LEFT JOIN note_tags nt ON nt.tag_id = t.id
               LEFT JOIN notes n ON n.id = nt.note_id AND n.trashed_at IS NULL AND n.is_template = 0""",
        )
        val own = LinkedHashMap<String, MutableSet<String>>()
        val real = HashSet<String>()
        for (r in rows) {
            val name = r["name"] as String
            real += name
            own.getOrPut(name) { mutableSetOf() }.also { s -> (r["note_id"] as String?)?.let(s::add) }
        }
        for (name in real.toList()) {
            val parts = name.split('/')
            for (i in 1 until parts.size) {
                val ancestor = parts.subList(0, i).joinToString("/")
                if (own.keys.none { it.equals(ancestor, ignoreCase = true) }) own[ancestor] = mutableSetOf()
            }
        }
        return own.keys.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it }).map { name ->
            val prefix = "${name.lowercase()}/"
            val all = HashSet<String>()
            for ((k, ids) in own) if (k.equals(name, ignoreCase = true) || k.lowercase().startsWith(prefix)) all += ids
            TagCount(name, own[name]!!.size, all.size, name !in real)
        }
    }

    fun setTags(noteId: String, names: List<String>) {
        val clean = names.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        db.run("DELETE FROM note_tags WHERE note_id = ?", noteId)
        for (name in clean) {
            val tagId = db.one("SELECT id FROM tags WHERE name = ? COLLATE NOCASE", name)?.get("id") as String?
                ?: newId().also { db.run("INSERT INTO tags (id, name) VALUES (?, ?)", it, name) }
            db.run("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)", noteId, tagId)
        }
        db.exec("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)")
    }

    // -------------------------------------------------------------- saved searches

    fun listSavedSearches(): List<SavedSearch> =
        db.all("SELECT id, name, query FROM saved_searches ORDER BY name COLLATE NOCASE").map { SavedSearch(it["id"] as String, it["name"] as String, it["query"] as String) }

    fun createSavedSearch(name: String, query: String): SavedSearch {
        if (name.isBlank() || query.isBlank()) throw ValidationError("name and query are required")
        val s = SavedSearch(newId(), name.trim(), query.trim())
        db.run("INSERT INTO saved_searches (id, name, query) VALUES (?, ?, ?)", s.id, s.name, s.query)
        return s
    }

    fun deleteSavedSearch(id: String) = db.run("DELETE FROM saved_searches WHERE id = ?", id)

    // ------------------------------------------------------------------ templates

    private fun fill(text: String): String {
        val t = kotlin.time.Instant.fromEpochMilliseconds(now()).toLocalDateTime(TimeZone.currentSystemDefault())
        val time = "${t.hour.toString().padStart(2, '0')}:${t.minute.toString().padStart(2, '0')}"
        return text.replace(Regex("\\{\\{\\s*date\\s*\\}\\}"), localDay()).replace(Regex("\\{\\{\\s*time\\s*\\}\\}"), time)
    }

    fun listTemplates() = listNotes(ListFilter(templates = true))

    /** Copies a note into the template library; {{date}} and {{time}} are filled in when it is used. */
    fun saveAsTemplate(noteId: String): Note {
        val src = getNote(noteId)
        val copy = createNote(NoteInput(notebookId = src.notebookId, title = src.title.ifEmpty { "Template" }, content = src.content))
        db.run("UPDATE notes SET is_template = 1 WHERE id = ?", copy.id)
        copyAttachments(src.id, copy.id)
        return getNote(copy.id)
    }

    fun createFromTemplate(templateId: String, notebookId: String? = null): Note {
        val tpl = getNote(templateId)
        if ((db.one("SELECT is_template FROM notes WHERE id = ?", templateId)!!["is_template"] as Long) == 0L) throw ValidationError("not a template")
        val created = createNote(NoteInput(notebookId = notebookId, title = fill(tpl.title), content = fill(tpl.content)))
        return copyAttachments(tpl.id, created.id)
    }

    // --------------------------------------------------------------- sync support

    fun getMeta(key: String): String? = db.one("SELECT value FROM meta WHERE key = ?", key)?.get("value") as String?

    fun setMeta(key: String, value: String?) {
        if (value == null) db.run("DELETE FROM meta WHERE key = ?", key)
        else db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value)
    }

    data class SyncState(val vv: Map<String, Long>, val hash: String)

    fun getSyncState(id: String): SyncState? = db.one("SELECT vv, hash FROM sync_state WHERE note_id = ?", id)?.let { r ->
        val vv = Json.parseToJsonElement(r["vv"] as String).jsonObject.mapValues { it.value.jsonPrimitive.long }
        SyncState(vv, r["hash"] as String)
    }

    fun setSyncState(id: String, vv: Map<String, Long>, hash: String) {
        val json = Json.encodeToString(JsonObject.serializer(), JsonObject(vv.mapValues { JsonPrimitive(it.value) }))
        db.run("INSERT OR REPLACE INTO sync_state (note_id, vv, hash) VALUES (?, ?, ?)", id, json, hash)
    }

    fun deleteSyncState(id: String) = db.run("DELETE FROM sync_state WHERE note_id = ?", id)

    fun listTombstones(): List<Tombstone> =
        db.all("SELECT * FROM sync_tombstones").map { Tombstone(it["note_id"] as String, it["deleted_at"] as Long, it["pushed"] == 1L) }

    fun markTombstonePushed(id: String) = db.run("UPDATE sync_tombstones SET pushed = 1 WHERE note_id = ?", id)
    fun removeTombstone(id: String) = db.run("DELETE FROM sync_tombstones WHERE note_id = ?", id)

    /** Notes that take part in sync (built-in templates are per device). */
    fun syncNoteIds(): List<String> = db.all("SELECT id FROM notes WHERE is_template != 2").map { it["id"] as String }

    fun hasNote(id: String) = db.one("SELECT 1 FROM notes WHERE id = ?", id) != null

    /** A self-contained snapshot of a note as it travels through sync. */
    fun exportForSync(id: String): SyncNote? {
        val row = db.one(
            "SELECT n.*, nb.name AS nb_name, nb.stack AS nb_stack FROM notes n JOIN notebooks nb ON nb.id = n.notebook_id WHERE n.id = ? AND n.is_template != 2", id,
        ) ?: return null
        val tags = db.all("SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?", id).map { it["name"] as String }.sorted()
        val attachments = db.all("SELECT id, filename, mime, size, md5, sha256, created_at FROM attachments WHERE note_id = ? ORDER BY id", id).map { a ->
            SyncNote.SyncAttachment(a["id"] as String, a["filename"] as String, a["mime"] as String, a["size"] as Long, a["md5"] as String, a["sha256"] as String, a["created_at"] as Long)
        }
        return SyncNote(
            id = id, notebookName = row["nb_name"] as String, notebookStack = row["nb_stack"] as String?, title = row["title"] as String,
            content = row["content"] as String, pinned = row["pinned"] == 1L, trashedAt = row["trashed_at"] as Long?,
            reminderAt = row["reminder_at"] as Long?, sourceUrl = row["source_url"] as String?, createdAt = row["created_at"] as Long,
            updatedAt = row["updated_at"] as Long, isTemplate = (row["is_template"] as Long) > 0, tags = tags, attachments = attachments,
        )
    }

    fun hasAttachment(id: String) = db.one("SELECT 1 FROM attachments WHERE id = ?", id) != null

    /**
     * Creates or overwrites a note from a synced snapshot, keeping its id. [blobs] holds the bytes of every attachment this
     * device does not have yet. The previous local content stays in the history.
     */
    fun applyFromSync(rec: SyncNote, blobs: Map<String, ByteArray>) {
        val content = Html.sanitize(rec.content)
        val added = mutableListOf<String>()
        tx {
            val notebook = findOrCreateNotebook(rec.notebookName, rec.notebookStack)
            if (hasNote(rec.id)) snapshotVersion(getNote(rec.id))
            db.run(
                """INSERT INTO notes (id, notebook_id, title, content, text, pinned, trashed_at, reminder_at, source_url, created_at, updated_at, is_template)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET notebook_id = excluded.notebook_id, title = excluded.title, content = excluded.content,
                     text = excluded.text, pinned = excluded.pinned, trashed_at = excluded.trashed_at, reminder_at = excluded.reminder_at,
                     source_url = excluded.source_url, created_at = excluded.created_at, updated_at = excluded.updated_at,
                     is_template = excluded.is_template""",
                rec.id, notebook.id, rec.title.take(500), content, Html.toText(content), rec.pinned, rec.trashedAt, rec.reminderAt,
                rec.sourceUrl, rec.createdAt, rec.updatedAt, rec.isTemplate,
            )
            setTags(rec.id, rec.tags)
            val keep = rec.attachments.map { it.id }.toSet()
            for (a in listAttachments(rec.id)) if (a.id !in keep) deleteAttachment(a.id)
            for (a in rec.attachments) {
                if (hasAttachment(a.id)) {
                    db.run("UPDATE attachments SET note_id = ? WHERE id = ?", rec.id, a.id)
                    continue
                }
                val data = blobs[a.id] ?: error("missing attachment data ${a.id}")
                this.blobs.put(a.id, data)
                db.run(
                    "INSERT INTO attachments (id, note_id, filename, mime, size, md5, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    a.id, rec.id, a.filename, a.mime, data.size.toLong(), a.md5, a.sha256, a.createdAt,
                )
                added += a.id
            }
            reindex(rec.id)
        }
        added.forEach { id -> attachmentListeners.forEach { it(id) } }
    }

    /** Permanent delete caused by sync: no tombstone of its own. */
    fun deleteForSync(id: String) {
        if (hasNote(id)) purgeNote(id, tombstone = false)
    }

    fun attachmentData(id: String): ByteArray = getAttachmentData(id)

    // ------------------------------------------------------ duplicate, links

    private fun copyAttachments(fromId: String, toId: String): Note {
        val idMap = LinkedHashMap<String, String>()
        for (a in listAttachments(fromId)) idMap[a.id] = addAttachment(toId, a.filename, a.mime, getAttachmentData(a.id)).id
        if (idMap.isNotEmpty()) {
            var content = getNote(toId).content
            for ((old, new) in idMap) content = content.replace("/api/attachments/$old", "/api/attachments/$new")
            db.run("UPDATE notes SET content = ?, text = ? WHERE id = ?", content, Html.toText(content), toId)
            reindex(toId)
        }
        return getNote(toId)
    }

    fun duplicateNote(id: String, suffix: String = " (copy)"): Note {
        val src = getNote(id)
        val copy = createNote(NoteInput(notebookId = src.notebookId, title = "${src.title}$suffix".trim(), content = src.content, tags = src.tags, sourceUrl = src.sourceUrl))
        return copyAttachments(src.id, copy.id)
    }

    /** Appends the other notes (in order) to the first, moves their files and tags, and trashes them. */
    fun mergeNotes(ids: List<String>): Note {
        val unique = ids.distinct()
        if (unique.size < 2) throw ValidationError("select at least two notes to merge")
        val notes = unique.map(::getNote)
        val target = notes.first()
        tx {
            var content = target.content
            val tags = LinkedHashSet(target.tags)
            for (n in notes.drop(1)) {
                content += "<hr><h2>${Html.escape(n.title)}</h2>${n.content}"
                tags += n.tags
                db.run("UPDATE attachments SET note_id = ? WHERE note_id = ?", target.id, n.id)
            }
            updateNote(target.id, NoteInput(content = content, tags = tags.toList()))
            for (n in notes.drop(1)) db.run("UPDATE notes SET trashed_at = ? WHERE id = ?", now(), n.id)
        }
        return getNote(target.id)
    }

    /** Notes that link to this one through a #/note/<id> link. */
    fun backlinks(id: String): List<Pair<String, String>> {
        getNote(id)
        return db.all(
            "SELECT id, title FROM notes WHERE trashed_at IS NULL AND is_template = 0 AND id != ? AND content LIKE ? ESCAPE '\\' ORDER BY updated_at DESC",
            id, "%#/note/${likeEscape(id)}%",
        ).map { it["id"] as String to it["title"] as String }
    }

    // ------------------------------------------------------------------- versions

    private fun snapshotVersion(note: Note) {
        if (note.content.isEmpty() && note.title.isEmpty()) return
        val last = db.one("SELECT saved_at FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC LIMIT 1", note.id)
        if (last != null && now() - (last["saved_at"] as Long) < VERSION_INTERVAL_MS) return
        db.run("INSERT INTO note_versions (note_id, title, content, saved_at) VALUES (?, ?, ?, ?)", note.id, note.title, note.content, now())
        db.run(
            "DELETE FROM note_versions WHERE note_id = ? AND id NOT IN (SELECT id FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC LIMIT ?)",
            note.id, note.id, MAX_VERSIONS,
        )
    }

    fun listVersions(noteId: String): List<Version> {
        getNote(noteId)
        return db.all("SELECT id, title, saved_at FROM note_versions WHERE note_id = ? ORDER BY saved_at DESC", noteId)
            .map { Version(it["id"] as Long, it["title"] as String, it["saved_at"] as Long) }
    }

    fun restoreVersion(noteId: String, versionId: Long): Note {
        val row = db.one("SELECT title, content FROM note_versions WHERE id = ? AND note_id = ?", versionId, noteId) ?: throw NotFoundError("version not found")
        return updateNote(noteId, NoteInput(title = row["title"] as String, content = row["content"] as String))
    }

    // ---------------------------------------------------------------- attachments

    fun addAttachment(noteId: String, filename: String, mime: String, data: ByteArray): Attachment {
        getNote(noteId)
        val att = Attachment(newId(), noteId, filename.ifEmpty { "file" }, mime.ifEmpty { "application/octet-stream" }, data.size.toLong(), Hashing.md5Hex(data), now())
        blobs.put(att.id, data)
        db.run(
            "INSERT INTO attachments (id, note_id, filename, mime, size, md5, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            att.id, noteId, att.filename, att.mime, att.size, att.md5, Hashing.sha256(data).toHex(), att.createdAt,
        )
        attachmentListeners.forEach { it(att.id) }
        return att
    }

    fun listAttachments(noteId: String): List<Attachment> =
        db.all("SELECT * FROM attachments WHERE note_id = ? ORDER BY created_at", noteId).map(::toAttachment)

    fun getAttachment(id: String): Attachment = db.one("SELECT * FROM attachments WHERE id = ?", id)?.let(::toAttachment) ?: throw NotFoundError("attachment not found")

    fun getAttachmentData(id: String): ByteArray {
        getAttachment(id)
        return blobs.get(id) ?: throw NotFoundError("attachment not found")
    }

    fun deleteAttachment(id: String) {
        val row = db.one("SELECT id, note_id FROM attachments WHERE id = ?", id) ?: throw NotFoundError("attachment not found")
        db.run("DELETE FROM attachments WHERE id = ?", id)
        removeBlobIfOrphan(id)
        reindex(row["note_id"] as String) // its text no longer belongs to the note
    }

    private fun removeBlobIfOrphan(id: String) {
        if (db.one("SELECT 1 FROM attachments WHERE id = ?", id) == null) blobs.delete(id)
    }

    private companion object {
        const val VERSION_INTERVAL_MS = 5 * 60 * 1000L
        const val MAX_VERSIONS = 50
        const val notebookSelect =
            "SELECT nb.*, (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.trashed_at IS NULL AND n.is_template = 0) AS note_count FROM notebooks nb"

        @OptIn(ExperimentalUuidApi::class)
        fun newId(): String = Uuid.random().toString()

        fun likeEscape(s: String) = s.replace(Regex("[\\\\%_]")) { "\\" + it.value }

        fun toNotebook(r: Row) = Notebook(r["id"] as String, r["name"] as String, r["stack"] as String?, r["created_at"] as Long, (r["note_count"] as Long).toInt())

        fun toAttachment(r: Row) = Attachment(r["id"] as String, r["note_id"] as String, r["filename"] as String, r["mime"] as String, r["size"] as Long, r["md5"] as String, r["created_at"] as Long)
    }
}
