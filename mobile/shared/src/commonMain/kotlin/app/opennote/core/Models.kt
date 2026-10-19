package app.opennote.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull

data class Notebook(val id: String, val name: String, val stack: String?, val createdAt: Long, val noteCount: Int)

data class NoteSummary(
    val id: String, val notebookId: String, val title: String, val snippet: String, val pinned: Boolean,
    val trashedAt: Long?, val reminderAt: Long?, val createdAt: Long, val updatedAt: Long, val tags: List<String>,
    val attachmentCount: Int,
)

data class Note(val summary: NoteSummary, val content: String, val sourceUrl: String?) {
    val id get() = summary.id
    val title get() = summary.title
    val notebookId get() = summary.notebookId
    val tags get() = summary.tags
}

data class Attachment(val id: String, val noteId: String, val filename: String, val mime: String, val size: Long, val md5: String, val createdAt: Long)

data class Task(val noteId: String, val noteTitle: String, val notebookId: String, val idx: Int, val text: String, val checked: Boolean, val due: String?)

data class TagCount(val name: String, val count: Int, val total: Int, val virtual: Boolean)

data class SavedSearch(val id: String, val name: String, val query: String)

data class Version(val id: Long, val title: String, val savedAt: Long)

data class Tombstone(val noteId: String, val deletedAt: Long, val pushed: Boolean)

/** What a note creation or update may set; null leaves a field as it is (use the `clear…` flags to set it to null). */
data class NoteInput(
    val notebookId: String? = null, val title: String? = null, val content: String? = null, val pinned: Boolean? = null,
    val reminderAt: Long? = null, val clearReminder: Boolean = false, val sourceUrl: String? = null, val clearSourceUrl: Boolean = false,
    val tags: List<String>? = null, val createdAt: Long? = null, val updatedAt: Long? = null,
)

data class ListFilter(
    val notebookId: String? = null, val tag: String? = null, val q: String? = null, val trashed: Boolean = false,
    val templates: Boolean = false, val pinned: Boolean = false, val reminders: Boolean = false, val limit: Int = 500,
)

/**
 * A note as it travels through sync (docs/SYNC-FORMAT.md 3.2). [toJson] writes the members in the reference order, so a
 * record built here hashes the same way as one built by the TypeScript engine.
 */
data class SyncNote(
    val id: String, val notebookName: String, val notebookStack: String?, val title: String, val content: String,
    val pinned: Boolean, val trashedAt: Long?, val reminderAt: Long?, val sourceUrl: String?, val createdAt: Long,
    val updatedAt: Long, val isTemplate: Boolean, val tags: List<String>, val attachments: List<SyncAttachment>,
) {
    data class SyncAttachment(val id: String, val filename: String, val mime: String, val size: Long, val md5: String, val sha256: String, val createdAt: Long)

    fun toJson(): JsonObject = JsonObject(
        linkedMapOf(
            "id" to JsonPrimitive(id),
            "notebook" to JsonObject(linkedMapOf("name" to JsonPrimitive(notebookName), "stack" to (notebookStack?.let(::JsonPrimitive) ?: JsonNull))),
            "title" to JsonPrimitive(title),
            "content" to JsonPrimitive(content),
            "pinned" to JsonPrimitive(pinned),
            "trashedAt" to (trashedAt?.let(::JsonPrimitive) ?: JsonNull),
            "reminderAt" to (reminderAt?.let(::JsonPrimitive) ?: JsonNull),
            "sourceUrl" to (sourceUrl?.let(::JsonPrimitive) ?: JsonNull),
            "createdAt" to JsonPrimitive(createdAt),
            "updatedAt" to JsonPrimitive(updatedAt),
            "isTemplate" to JsonPrimitive(isTemplate),
            "tags" to JsonArray(tags.map(::JsonPrimitive)),
            "attachments" to JsonArray(
                attachments.map { a ->
                    JsonObject(
                        linkedMapOf(
                            "id" to JsonPrimitive(a.id), "filename" to JsonPrimitive(a.filename), "mime" to JsonPrimitive(a.mime),
                            "size" to JsonPrimitive(a.size), "md5" to JsonPrimitive(a.md5), "sha256" to JsonPrimitive(a.sha256),
                            "createdAt" to JsonPrimitive(a.createdAt),
                        ),
                    )
                },
            ),
        ),
    )

    companion object {
        private fun JsonObject.str(k: String) = this[k]!!.jsonPrimitive.content
        private fun JsonObject.strOrNull(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
        private fun JsonObject.longOrNull(k: String) = (this[k] as? JsonPrimitive)?.longOrNull

        fun fromJson(o: JsonObject): SyncNote {
            val nb = o["notebook"]!!.jsonObject
            return SyncNote(
                id = o.str("id"), notebookName = nb.str("name"), notebookStack = nb.strOrNull("stack"),
                title = o.str("title"), content = o.str("content"), pinned = o["pinned"]!!.jsonPrimitive.boolean,
                trashedAt = o.longOrNull("trashedAt"), reminderAt = o.longOrNull("reminderAt"), sourceUrl = o.strOrNull("sourceUrl"),
                createdAt = o["createdAt"]!!.jsonPrimitive.long, updatedAt = o["updatedAt"]!!.jsonPrimitive.long,
                isTemplate = o["isTemplate"]!!.jsonPrimitive.boolean,
                tags = o["tags"]!!.jsonArray.map { it.jsonPrimitive.content },
                attachments = o["attachments"]!!.jsonArray.map { e ->
                    val a = e.jsonObject
                    SyncAttachment(a.str("id"), a.str("filename"), a.str("mime"), a["size"]!!.jsonPrimitive.long, a.str("md5"), a.str("sha256"), a["createdAt"]!!.jsonPrimitive.long)
                },
            )
        }
    }
}

class NotFoundError(message: String) : Exception(message)
class ValidationError(message: String) : Exception(message)
