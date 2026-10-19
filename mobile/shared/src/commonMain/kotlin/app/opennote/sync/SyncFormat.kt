package app.opennote.sync

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/** The pieces of docs/SYNC-FORMAT.md that every reader and writer needs to agree on, byte for byte. */
object SyncFormat {
    const val VERSION = 1
    val NOTE_ID = Regex("^[0-9a-f-]{36}$")
    val DEVICE_ID = Regex("^[\\w-]{8,64}$")
    val BLOB_NAME = Regex("^[0-9a-f]{64}$")

    /** 3.4: SHA-256 of the record serialised without `chk`, members in the order held. */
    fun checksum(record: JsonObject): String = Hashing.sha256Hex(jsStringify(JsonObject(record.filterKeys { it != "chk" })))

    /** Adds `chk` as the last member and returns the bytes to write (before encryption). */
    fun sealRecord(record: JsonObject): ByteArray {
        val withChk = JsonObject(record.filterKeys { it != "chk" } + ("chk" to JsonPrimitive(checksum(record))))
        return jsStringify(withChk).encodeToByteArray()
    }

    /** A record read from a file is usable only if it passes 3.1. */
    fun isValidRecord(r: JsonObject, path: String): Boolean {
        val id = (r["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return false
        val device = (r["deviceId"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return false
        if ((r["v"] as? JsonPrimitive)?.content != VERSION.toString()) return false
        if (!NOTE_ID.matches(id) || !DEVICE_ID.matches(device) || path != "notes/$id/$device.json") return false
        if (r["vv"] !is JsonObject) return false
        if ((r["chk"] as? JsonPrimitive)?.content != checksum(r)) return false
        if ((r["deleted"] as? JsonPrimitive)?.content == "true") return true
        val note = r["note"] as? JsonObject ?: return false
        return (note["id"] as? JsonPrimitive)?.content == id && (note["content"] as? JsonPrimitive)?.isString == true
    }

    /** 3.5: hash of a note's syncable content. */
    fun noteHash(note: JsonObject): String {
        val notebook = note["notebook"]!!.jsonObject
        val tags = note["tags"]!!.jsonArray.map { it.jsonPrimitive.content }.sorted() // UTF-16 code units, like JS sort()
        val attachments = note["attachments"]!!.jsonArray.map { a ->
            val o = a.jsonObject
            JsonArray(listOf(o["id"]!!, o["filename"]!!, o["mime"]!!, o["sha256"]!!))
        }
        val parts: List<JsonElement> = listOf(
            note["id"]!!, notebook["name"]!!, notebook["stack"] ?: JsonNull, note["title"]!!, note["content"]!!,
            note["pinned"]!!, note["trashedAt"] ?: JsonNull, note["reminderAt"] ?: JsonNull, note["sourceUrl"] ?: JsonNull,
            note["createdAt"]!!, note["updatedAt"]!!, note["isTemplate"]!!,
            JsonArray(tags.map { JsonPrimitive(it) }), JsonArray(attachments),
        )
        return Hashing.sha256Hex(jsStringify(JsonArray(parts)))
    }

    /** 3.6: a UUID derived from text, so every device creates the same conflict copy. */
    fun derivedId(text: String): String {
        val h = Hashing.sha256Hex(text)
        return "${h.substring(0, 8)}-${h.substring(8, 12)}-4${h.substring(13, 16)}-a${h.substring(17, 20)}-${h.substring(20, 32)}"
    }

    enum class Order { EQUAL, BEFORE, AFTER, CONCURRENT }

    /** 5: compares two version vectors member-wise, a missing member counting as 0. */
    fun compareVV(a: JsonObject, b: JsonObject): Order {
        var aAhead = false
        var bAhead = false
        for (k in a.keys + b.keys) {
            val x = a[k]?.jsonPrimitive?.long ?: 0
            val y = b[k]?.jsonPrimitive?.long ?: 0
            if (x > y) aAhead = true
            if (y > x) bAhead = true
        }
        return when {
            aAhead && bAhead -> Order.CONCURRENT
            aAhead -> Order.AFTER
            bAhead -> Order.BEFORE
            else -> Order.EQUAL
        }
    }
}
