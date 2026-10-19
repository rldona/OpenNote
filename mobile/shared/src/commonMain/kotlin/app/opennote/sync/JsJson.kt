package app.opennote.sync

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * JSON text exactly as ECMAScript `JSON.stringify` writes it, which checksums and content hashes depend on
 * (docs/SYNC-FORMAT.md 3.4). Members keep the order they are held in: a [JsonObject] parsed with [parseJson] keeps the order
 * of the file.
 */
fun jsStringify(element: JsonElement): String = StringBuilder().also { write(it, element) }.toString()

/** Parses JSON keeping member order (kotlinx-serialization objects are ordered maps). */
fun parseJson(text: String): JsonElement = Json.parseToJsonElement(text)

private fun write(out: StringBuilder, e: JsonElement) {
    when (e) {
        is JsonNull -> out.append("null")
        is JsonObject -> {
            out.append('{')
            var first = true
            for ((k, v) in e) {
                if (!first) out.append(',')
                first = false
                writeString(out, k)
                out.append(':')
                write(out, v)
            }
            out.append('}')
        }
        is JsonArray -> {
            out.append('[')
            e.forEachIndexed { i, v ->
                if (i > 0) out.append(',')
                write(out, v)
            }
            out.append(']')
        }
        is JsonPrimitive -> when {
            e.isString -> writeString(out, e.content)
            // Literals and numbers: the files only hold integers written by JSON.stringify, so their text is already canonical.
            else -> out.append(e.content)
        }
    }
}

private const val HEX = "0123456789abcdef"

private fun writeString(out: StringBuilder, s: String) {
    out.append('"')
    var i = 0
    while (i < s.length) {
        val c = s[i]
        when {
            c == '"' -> out.append("\\\"")
            c == '\\' -> out.append("\\\\")
            c == '\b' -> out.append("\\b")
            c == '\u000C' -> out.append("\\f")
            c == '\n' -> out.append("\\n")
            c == '\r' -> out.append("\\r")
            c == '\t' -> out.append("\\t")
            c < ' ' -> unicodeEscape(out, c)
            c.isHighSurrogate() -> {
                if (i + 1 < s.length && s[i + 1].isLowSurrogate()) {
                    out.append(c).append(s[i + 1])
                    i++
                } else {
                    unicodeEscape(out, c) // a lone surrogate is escaped (well-formed JSON.stringify, ES2019)
                }
            }
            c.isLowSurrogate() -> unicodeEscape(out, c)
            else -> out.append(c)
        }
        i++
    }
    out.append('"')
}

private fun unicodeEscape(out: StringBuilder, c: Char) {
    val v = c.code
    out.append("\\u").append(HEX[v shr 12 and 0xF]).append(HEX[v shr 8 and 0xF]).append(HEX[v shr 4 and 0xF]).append(HEX[v and 0xF])
}
