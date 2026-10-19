package app.opennote.sync

import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.readRawBytes
import io.ktor.http.HttpMethod
import io.ktor.http.encodeURLParameter
import io.ktor.http.isSuccess
import kotlin.random.Random
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * [SyncTransport] over Google Drive's hidden application data folder (scope `drive.appdata`), the Kotlin counterpart of
 * server/src/sync-gdrive.ts. Drive has no paths: every record is one flat file named with its full path. One paginated
 * listing per run builds an index; only changed files (by md5Checksum) are downloaded.
 */
class GoogleDriveTransport(
    private val http: HttpClient,
    /** An access token for drive.appdata; `true` asks for a new one after a 401. */
    private val getToken: suspend (forceRefresh: Boolean) -> String,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) : SyncTransport {
    private data class DriveFile(val id: String, val name: String, val md5: String?, val size: String?, val createdTime: String?)

    private var index: MutableMap<String, DriveFile>? = null

    private fun earlier(a: DriveFile, b: DriveFile) = if ((a.createdTime ?: "") <= (b.createdTime ?: "")) a else b

    private fun file(o: JsonObject) = DriveFile(
        o["id"]!!.jsonPrimitive.content, o["name"]!!.jsonPrimitive.content, (o["md5Checksum"] as? JsonPrimitive)?.content,
        (o["size"] as? JsonPrimitive)?.content, (o["createdTime"] as? JsonPrimitive)?.content,
    )

    // ------------------------------------------------------------------ HTTP

    /** One authenticated request with retries: a new token after a 401, backoff on 429 and 5xx. */
    private suspend fun call(url: String, method: HttpMethod = HttpMethod.Get, contentType: String? = null, body: ByteArray? = null, extra: Map<String, String> = emptyMap()): HttpResponse {
        var refreshed = false
        var attempt = 1
        while (true) {
            val token = getToken(refreshed)
            val res = http.request(url) {
                this.method = method
                header("Authorization", "Bearer $token")
                contentType?.let { header("Content-Type", it) }
                extra.forEach { (k, v) -> header(k, v) }
                if (body != null) setBody(body)
            }
            if (res.status.isSuccess()) return res
            val status = res.status.value
            if (status == 401 && !refreshed) { refreshed = true; continue }
            if ((status == 429 || status >= 500) && attempt < MAX_ATTEMPTS) {
                sleep(500L * (1 shl (attempt - 1)) + Random.nextLong(250))
                attempt++
                continue
            }
            val detail = runCatching { res.bodyAsText() }.getOrDefault("").take(200)
            throw when {
                status == 401 -> SyncError("Google Drive rejected the sign-in: connect again")
                status == 403 && Regex("storageQuotaExceeded|quota", RegexOption.IGNORE_CASE).containsMatchIn(detail) -> SyncError("Your Google Drive storage is full")
                status == 403 -> SyncError("Google Drive refused the request (403). $detail")
                else -> SyncError("Google Drive error $status. $detail")
            }
        }
    }

    private suspend fun json(res: HttpResponse) = parseJson(res.bodyAsText()).jsonObject

    private fun q(vararg params: Pair<String, String>) = params.joinToString("&") { (k, v) -> "$k=${v.encodeURLParameter()}" }

    // ----------------------------------------------------------------- index

    private suspend fun load(): MutableMap<String, DriveFile> {
        index?.let { return it }
        val out = LinkedHashMap<String, DriveFile>()
        var pageToken: String? = null
        do {
            val params = mutableListOf("spaces" to "appDataFolder", "pageSize" to "1000", "q" to "trashed = false", "fields" to "nextPageToken,files($FIELDS)")
            pageToken?.let { params += "pageToken" to it }
            val page = json(call("$API/files?${q(*params.toTypedArray())}"))
            for (e in (page["files"] as? JsonArray) ?: JsonArray(emptyList())) {
                val f = file(e.jsonObject)
                out[f.name] = out[f.name]?.let { earlier(it, f) } ?: f // a name written twice by a race: the oldest is the real one
            }
            pageToken = (page["nextPageToken"] as? JsonPrimitive)?.content
        } while (pageToken != null)
        index = out
        return out
    }

    // ------------------------------------------------------------- transport

    override suspend fun list(dir: String): List<TransportEntry> {
        val prefix = checkPath(dir).joinToString("/")
        val out = LinkedHashMap<String, String>()
        for ((path, f) in load()) {
            if (prefix.isNotEmpty() && !path.startsWith("$prefix/")) continue
            val rest = if (prefix.isNotEmpty()) path.substring(prefix.length + 1) else path
            val slash = rest.indexOf('/')
            if (slash >= 0) out[rest.substring(0, slash)] = "dir" else out[rest] = f.md5 ?: f.size ?: f.id
        }
        return out.map { TransportEntry(it.key, it.value) }
    }

    override suspend fun exists(path: String): Boolean { checkPath(path); return path in load() }

    override suspend fun read(path: String): ByteArray? {
        checkPath(path)
        val f = load()[path] ?: return null
        return try {
            call("$API/files/${f.id}?alt=media").readRawBytes()
        } catch (e: SyncError) {
            if ("error 404" in (e.message ?: "")) { load().remove(path); null } else throw e // deleted by another device since we listed
        }
    }

    override suspend fun write(path: String, data: ByteArray) {
        checkPath(path)
        val idx = load()
        idx[path] = idx[path]?.let { update(it.id, data) } ?: create(path, data)
    }

    override suspend fun writeIfAbsent(path: String, data: ByteArray): Boolean {
        checkPath(path)
        val idx = load()
        if (path in idx) return false
        val mine = create(path, data)
        // Drive cannot create "only if absent": if another device created the same name at the same moment, the oldest wins.
        val same = (json(call("$API/files?${q("spaces" to "appDataFolder", "q" to "name = '$path' and trashed = false", "fields" to "files($FIELDS)")}"))["files"] as? JsonArray)
            ?.map { file(it.jsonObject) } ?: listOf(mine)
        val winner = same.fold(mine, ::earlier)
        if (winner.id != mine.id) {
            runCatching { call("$API/files/${mine.id}", HttpMethod.Delete) }
            idx[path] = winner
            return false
        }
        idx[path] = mine
        return true
    }

    override suspend fun remove(path: String) {
        checkPath(path)
        val idx = load()
        val f = idx[path] ?: return
        try {
            call("$API/files/${f.id}", HttpMethod.Delete)
        } catch (e: SyncError) {
            if ("error 404" !in (e.message ?: "")) throw e
        }
        idx.remove(path)
    }

    // --------------------------------------------------------------- uploads

    private suspend fun create(name: String, data: ByteArray): DriveFile {
        val meta = jsStringify(JsonObject(mapOf("name" to JsonPrimitive(name), "parents" to JsonArray(listOf(JsonPrimitive("appDataFolder"))))))
        if (data.size > SIMPLE_LIMIT) return resumable("$UPLOAD/files?uploadType=resumable&fields=$FIELDS", HttpMethod.Post, meta, data)
        val boundary = "opennote-${Random.nextLong().toULong().toString(36)}"
        val body = "--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n$meta\r\n".encodeToByteArray() +
            "--$boundary\r\nContent-Type: application/octet-stream\r\n\r\n".encodeToByteArray() + data + "\r\n--$boundary--".encodeToByteArray()
        return file(json(call("$UPLOAD/files?uploadType=multipart&fields=$FIELDS", HttpMethod.Post, "multipart/related; boundary=$boundary", body)))
    }

    private suspend fun update(id: String, data: ByteArray): DriveFile {
        if (data.size > SIMPLE_LIMIT) return resumable("$UPLOAD/files/$id?uploadType=resumable&fields=$FIELDS", HttpMethod.Patch, "{}", data)
        return file(json(call("$UPLOAD/files/$id?uploadType=media&fields=$FIELDS", HttpMethod.Patch, "application/octet-stream", data)))
    }

    /** Resumable upload in one request: start a session, then send all the bytes to the session address. */
    private suspend fun resumable(url: String, method: HttpMethod, meta: String, data: ByteArray): DriveFile {
        val start = call(url, method, "application/json; charset=UTF-8", meta.encodeToByteArray(), mapOf("X-Upload-Content-Type" to "application/octet-stream"))
        val session = start.headers["Location"] ?: throw SyncError("Google Drive did not start the upload")
        return file(json(call(session, HttpMethod.Put, "application/octet-stream", data)))
    }

    private companion object {
        const val API = "https://www.googleapis.com/drive/v3"
        const val UPLOAD = "https://www.googleapis.com/upload/drive/v3"
        const val FIELDS = "id,name,md5Checksum,size,createdTime"
        /** Drive's limit for simple and multipart uploads; bigger bodies use the resumable protocol. */
        const val SIMPLE_LIMIT = 5 * 1024 * 1024
        const val MAX_ATTEMPTS = 4
    }
}
