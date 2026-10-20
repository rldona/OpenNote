package app.opennote.ui

import app.opennote.core.Html
import app.opennote.core.ListFilter
import app.opennote.core.NoteInput
import androidx.compose.ui.graphics.ImageBitmap
import app.opennote.sync.GoogleAuth
import app.opennote.sync.GoogleProfile
import io.ktor.client.request.get
import io.ktor.client.statement.readRawBytes
import kotlin.io.encoding.Base64
import app.opennote.sync.GoogleDriveTransport
import app.opennote.sync.SyncStatus
import io.ktor.client.HttpClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * What the screens, the notifications and the background tasks share: one open database, the Google sign-in, sync after
 * edits and the reminder notifications kept in step with the notes.
 */
object AppCore {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lock = Mutex()
    private var opened: Repo? = null

    val secrets by lazy { platformSecrets() }
    private val http by lazy { HttpClient() }

    /** Null when this build has no Google client ID: sync is then not offered. */
    val auth: GoogleAuth? by lazy { signInConfig()?.let { GoogleAuth(http, it.clientId, it.redirectUri, secrets) } }

    /** Google Drive is connected (changes on connect and disconnect). */
    val connected = MutableStateFlow(false)

    /** The Google account sync uses, and its picture, once known (kept in the meta table, not synced). */
    val profile = MutableStateFlow<GoogleProfile?>(null)
    val photo = MutableStateFlow<ImageBitmap?>(null)

    /** A note to show, from a tapped notification or something shared to the app. */
    val openNote = MutableStateFlow<String?>(null)

    suspend fun repo(): Repo = lock.withLock {
        opened ?: Repo.open(secrets, auth?.let { a -> { GoogleDriveTransport(http, a::getToken) } }).also {
            opened = it
            connected.value = auth?.connected == true
            watch(it)
            loadProfile(it)
        }
    }

    val readyToSync: Boolean get() = auth?.connected == true && opened?.engine?.hasPassphrase == true

    @OptIn(FlowPreview::class)
    private fun watch(r: Repo) {
        scope.launch { r.revision.debounce(800).collect { refreshReminders(r) } }
        // Edits are sent a few seconds after typing stops.
        scope.launch { r.edits.drop(1).debounce(4000).collect { syncIfReady() } }
    }

    suspend fun syncIfReady(): SyncStatus? = if (readyToSync) repo().sync() else null

    /** Signs in with Google in the system browser; false if the person cancelled. */
    suspend fun connectGoogle(): Boolean {
        val a = auth ?: return false
        val cfg = signInConfig() ?: return false
        val pending = a.begin()
        val redirect = openSignInBrowser(pending.url, cfg.scheme) ?: return false
        a.complete(pending, redirect)
        connected.value = true
        scheduleBackgroundSync()
        scope.launch { refreshProfile(repo(), force = true) }
        return true
    }

    suspend fun disconnectGoogle() {
        auth?.disconnect()
        connected.value = false
        profile.value = null
        photo.value = null
        repo().write { setMeta(PROFILE_KEY, null); setMeta(PHOTO_KEY, null) }
    }

    fun onForeground() { scope.launch { syncIfReady() } }

    /** The background task: sync, then reschedule the reminders the sync may have changed. False when it failed. */
    suspend fun backgroundSync(): Boolean {
        val r = repo()
        val status = syncIfReady()
        refreshReminders(r)
        return status?.ok != false
    }

    suspend fun refreshReminders(r: Repo) {
        val now = nowMs()
        val alerts = r.read { listNotes(ListFilter(reminders = true)) }
            .filter { it.trashedAt == null && (it.reminderAt ?: 0) > now }
            .sortedBy { it.reminderAt }
            .take(MAX_ALERTS)
            .map { ReminderAlert(it.id, it.title.ifBlank { strings.untitled }, it.reminderAt!!) }
        runCatching { scheduleReminders(alerts) }
    }

    /** Text, a link or files shared from another app become a new note, which is then opened. */
    suspend fun importShared(subject: String?, text: String?, files: List<SharedFile>) {
        val body = text?.trim().orEmpty()
        val url = body.takeIf { URL.matches(it) }
        val title = subject?.trim()?.takeIf { it.isNotEmpty() }
            ?: url?.substringAfter("://")?.substringBefore('/')
            ?: body.lineSequence().firstOrNull { it.isNotBlank() }?.trim()?.take(80)
            ?: files.firstOrNull()?.name ?: ""
        val html = buildString {
            if (url != null) append("<p><a href=\"${Html.escape(url).replace("\"", "&quot;")}\">${Html.escape(url)}</a></p>")
            else body.split(Regex("\n{2,}")).filter { it.isNotBlank() }.forEach { append("<p>${Html.escape(it.trim()).replace("\n", "<br>")}</p>") }
        }
        val r = repo()
        val id = r.write {
            val note = createNote(NoteInput(title = title, content = html, sourceUrl = url))
            if (files.isNotEmpty()) {
                val extra = files.joinToString("") { f ->
                    val a = addAttachment(note.id, f.name, f.mime, f.data)
                    if (f.mime.startsWith("image/")) "<p><img src=\"/api/attachments/${a.id}\"></p>" else ""
                }
                updateNote(note.id, NoteInput(content = html + extra))
            }
            note.id
        }
        openNote.value = id
    }

    private val URL = Regex("^https?://\\S+$")

    private const val PROFILE_KEY = "ui.google.profile"
    private const val PHOTO_KEY = "ui.google.photo"
    private const val PROFILE_AT_KEY = "ui.google.profileAt"

    /** What was learnt before, at once; then a fresh look once a day (name and picture can change). */
    private fun loadProfile(r: Repo) {
        scope.launch {
            if (auth?.connected != true) return@launch
            profile.value = GoogleProfile.fromJson(r.read { getMeta(PROFILE_KEY) })
            r.read { getMeta(PHOTO_KEY) }?.let { b64 -> photo.value = runCatching { decodeImage(Base64.decode(b64), 160) }.getOrNull() }
            refreshProfile(r)
        }
    }

    private suspend fun refreshProfile(r: Repo, force: Boolean = false) {
        val a = auth ?: return
        val at = r.read { getMeta(PROFILE_AT_KEY) }?.toLongOrNull() ?: 0
        if (!force && profile.value != null && nowMs() - at < 24 * 3600_000L) return
        val p = a.fetchProfile() ?: return
        // Google's picture address takes the size at the end ("=s64"): ask for one that stays sharp on the phone.
        val bytes = p.photo?.let { url ->
            runCatching { http.get(url.replace(Regex("=s\\d+(-c)?$"), "") + "=s160-c").readRawBytes() }.getOrNull()
        }
        // Read-only calls: the screens do not need to reload for this.
        r.read {
            setMeta(PROFILE_KEY, p.toJson())
            setMeta(PROFILE_AT_KEY, nowMs().toString())
            setMeta(PHOTO_KEY, bytes?.let { Base64.encode(it) })
        }
        profile.value = p
        photo.value = bytes?.let { runCatching { decodeImage(it, 160) }.getOrNull() }
    }

    /** iOS keeps at most 64 pending notifications per app. */
    private const val MAX_ALERTS = 60
}

/** A file shared to the app. */
class SharedFile(val name: String, val mime: String, val data: ByteArray)
