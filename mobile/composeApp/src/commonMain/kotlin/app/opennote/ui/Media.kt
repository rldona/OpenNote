package app.opennote.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.ImageBitmap
import app.opennote.core.Attachment
import app.opennote.core.Html

/**
 * The camera, the document scanner and the file pickers of the platform. Each call shows the system's screen and answers
 * once: an empty result means the person cancelled.
 */
interface Capture {
    /** The system document scanner exists here (iOS VisionKit on a device). */
    val canScan: Boolean
    fun photo(onResult: (SharedFile?) -> Unit)
    fun scan(onResult: (List<SharedFile>) -> Unit)
    fun files(onResult: (List<SharedFile>) -> Unit)
}

@Composable
expect fun rememberCapture(): Capture

/** A voice recording in AAC (.m4a), the format both platforms record natively and every WebView plays. */
expect class AudioRecorder() {
    /** Asks for the microphone if needed and starts; false when it is not allowed or not available. */
    suspend fun start(): Boolean
    fun pause()
    fun resume()
    /** Loudness right now, 0…1, for the level meter. */
    fun level(): Float
    /** Stops and returns the recording (null if nothing was recorded). */
    fun stop(): SharedFile?
    fun cancel()
}

/** Decodes an image, scaled down so that its longer side is at most [maxPx]. */
expect fun decodeImage(bytes: ByteArray, maxPx: Int): ImageBitmap?

expect fun encodePng(image: ImageBitmap): ByteArray

/** The app's version as people see it ("0.6.0"). */
expect fun appVersion(): String

/** How an attachment appears in a note's HTML, the same markup the web editor writes. */
fun attachmentHtml(a: Attachment): String {
    val src = "/api/attachments/${a.id}"
    return when {
        a.mime.startsWith("image/") -> "<p><img src=\"$src\"></p>"
        a.mime.startsWith("audio/") -> "<audio src=\"$src\" controls=\"true\" preload=\"metadata\"></audio>"
        else -> "<p><a href=\"$src\">${Html.escape(a.filename)}</a></p>"
    }
}

/** Puts an attachment into the editor at the cursor. */
fun EditorController.insert(a: Attachment) {
    val src = "/api/attachments/${a.id}"
    when {
        a.mime.startsWith("image/") -> exec("image", src)
        a.mime.startsWith("audio/") -> exec("audio", src)
        else -> exec("file", "{\"href\":${jsString(src)},\"name\":${jsString(a.filename)}}")
    }
}

/** Small images for note lists, decoded once. */
object Thumbnails {
    private val cache = LinkedHashMap<String, ImageBitmap?>()

    fun cached(id: String): ImageBitmap? = cache[id]
    fun has(id: String) = cache.containsKey(id)

    fun put(id: String, image: ImageBitmap?) {
        cache[id] = image
        while (cache.size > 120) cache.remove(cache.keys.first())
    }
}
