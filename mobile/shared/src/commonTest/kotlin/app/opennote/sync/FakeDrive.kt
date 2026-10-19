package app.opennote.sync

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * An in-memory stand-in for the part of the Google Drive v3 API the transport uses (server/test/fake-drive.ts): bearer
 * tokens, the appDataFolder space, paginated listing, multipart and resumable uploads, md5 checksums, createdTime order, and
 * failures injected by the test.
 */
class FakeDrive {
    class Stored(val id: String, var name: String, var data: ByteArray, val createdTime: String) {
        val md5 get() = Hashing.md5Hex(data)
    }

    val files = LinkedHashMap<String, Stored>()
    private val sessions = HashMap<String, Pair<String?, String?>>()
    val calls = mutableListOf<String>()
    var validToken = "good"
    val failNext = ArrayDeque<Int>()
    var pageSize = 1000
    private var counter = 0
    private var tick = 0

    fun names() = files.values.map { it.name }.sorted()

    private fun meta(f: Stored) = JsonObject(
        mapOf("id" to JsonPrimitive(f.id), "name" to JsonPrimitive(f.name), "md5Checksum" to JsonPrimitive(f.md5), "size" to JsonPrimitive(f.data.size.toString()), "createdTime" to JsonPrimitive(f.createdTime)),
    )

    private fun save(name: String, data: ByteArray, id: String? = null): Stored {
        val f = id?.let { files[it] } ?: Stored("f${++counter}", name, data, "2026-01-01T00:00:${(tick++).toString().padStart(2, '0')}.000Z")
        f.data = data
        files[f.id] = f
        return f
    }

    private fun MockRequestHandleScope.json(body: JsonObject, status: Int = 200) =
        respond(jsStringify(body), HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, "application/json"))

    private fun err(message: String) = JsonObject(mapOf("error" to JsonPrimitive(message)))

    val client = HttpClient(MockEngine { req -> handle(req) })

    private suspend fun MockRequestHandleScope.handle(req: HttpRequestData): io.ktor.client.request.HttpResponseData {
        val url = req.url
        val p = url.parameters
        val path = url.encodedPath
        calls += "${req.method.value} $path${p["uploadType"]?.let { "?$it" } ?: ""}"
        if (req.headers[HttpHeaders.Authorization] != "Bearer $validToken") return json(err("Invalid Credentials"), 401)
        failNext.removeFirstOrNull()?.let { return json(err("injected"), it) }
        val body = req.body.toByteArray()

        if (req.method == HttpMethod.Get && path == "/drive/v3/files") {
            if (p["spaces"] != "appDataFolder") return json(err("wrong space"), 400)
            val byName = Regex("name = '([^']+)'").find(p["q"] ?: "")?.groupValues?.get(1)
            val all = files.values.filter { byName == null || it.name == byName }
            val size = minOf(pageSize, p["pageSize"]?.toInt() ?: 100)
            val start = p["pageToken"]?.toInt() ?: 0
            val page = all.drop(start).take(size)
            val out = mutableMapOf<String, kotlinx.serialization.json.JsonElement>("files" to JsonArray(page.map(::meta)))
            if (start + size < all.size) out["nextPageToken"] = JsonPrimitive((start + size).toString())
            return json(JsonObject(out))
        }
        Regex("^/drive/v3/files/([^/]+)$").find(path)?.let { m ->
            val f = files[m.groupValues[1]] ?: return json(err("not found"), 404)
            if (req.method == HttpMethod.Delete) { files.remove(f.id); return respond("", HttpStatusCode.NoContent) }
            if (req.method == HttpMethod.Get && p["alt"] == "media") return respond(f.data, HttpStatusCode.OK)
        }
        if (path == "/upload/drive/v3/files" && req.method == HttpMethod.Post && p["uploadType"] == "multipart") {
            val boundary = Regex("boundary=(.+)$").find(req.body.contentType?.toString() ?: req.headers[HttpHeaders.ContentType] ?: "")!!.groupValues[1]
            val text = body.decodeToString()
            val metaJson = parseJson(text.split("--$boundary")[1].split("\r\n\r\n")[1].removeSuffix("\r\n")).jsonObject
            val marker = "--$boundary\r\nContent-Type: application/octet-stream\r\n\r\n".encodeToByteArray()
            val start = indexOf(body, marker) + marker.size
            val end = body.size - "\r\n--$boundary--".length
            if (metaJson["parents"]?.jsonArray?.any { it.jsonPrimitive.content == "appDataFolder" } != true) return json(err("must live in appDataFolder"), 400)
            return json(meta(save(metaJson["name"]!!.jsonPrimitive.content, body.copyOfRange(start, end))))
        }
        val upd = Regex("^/upload/drive/v3/files/([^/]+)$").find(path)
        if (upd != null && req.method == HttpMethod.Patch && p["uploadType"] == "media") {
            if (upd.groupValues[1] !in files) return json(err("not found"), 404)
            return json(meta(save("", body, upd.groupValues[1])))
        }
        if (p["uploadType"] == "resumable" && (req.method == HttpMethod.Post || req.method == HttpMethod.Patch)) {
            val m = if (body.isNotEmpty()) parseJson(body.decodeToString()).jsonObject else JsonObject(emptyMap())
            val sid = "s${++counter}"
            sessions[sid] = upd?.groupValues?.get(1) to (m["name"] as? JsonPrimitive)?.content
            return respond("", HttpStatusCode.OK, headersOf(HttpHeaders.Location, "https://www.googleapis.com/upload/drive/v3/files?upload_id=$sid"))
        }
        if (path == "/upload/drive/v3/files" && req.method == HttpMethod.Put) {
            val (id, name) = sessions[p["upload_id"]] ?: return json(err("no session"), 404)
            return json(meta(save(name ?: "", body, id)))
        }
        return json(err("unhandled ${req.method.value} $path"), 400)
    }

    private fun indexOf(hay: ByteArray, needle: ByteArray): Int {
        outer@ for (i in 0..hay.size - needle.size) {
            for (j in needle.indices) if (hay[i + j] != needle[j]) continue@outer
            return i
        }
        return -1
    }
}
