package app.opennote.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** What the formatting bar shows, as reported by the embedded editor (web/src/embed/main.ts, EditorState). */
@Serializable
data class EditorState(
    val bold: Boolean = false, val italic: Boolean = false, val underline: Boolean = false, val strike: Boolean = false,
    val highlight: Boolean = false, val link: Boolean = false,
    val paragraph: Boolean = false, val heading1: Boolean = false, val heading2: Boolean = false,
    val blockquote: Boolean = false, val codeBlock: Boolean = false,
    val bulletList: Boolean = false, val orderedList: Boolean = false, val taskList: Boolean = false,
    val inTask: Boolean = false, val due: String? = null, val canUndo: Boolean = false, val canRedo: Boolean = false,
)

/** Messages from the page: ready, change (html), state, link (href). */
sealed interface EditorEvent {
    data object Ready : EditorEvent
    data class Change(val html: String) : EditorEvent
    data class State(val state: EditorState) : EditorEvent
    data class Link(val href: String) : EditorEvent
}

private val json = Json { ignoreUnknownKeys = true }

fun parseEditorMessage(text: String): EditorEvent? {
    val o = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
    return when (o["type"]?.jsonPrimitive?.content) {
        "ready" -> EditorEvent.Ready
        "change" -> EditorEvent.Change(o["html"]!!.jsonPrimitive.content)
        "state" -> EditorEvent.State(json.decodeFromJsonElement(EditorState.serializer(), o["state"] as JsonObject))
        "link" -> EditorEvent.Link(o["href"]!!.jsonPrimitive.content)
        else -> null
    }
}

/** A JavaScript string literal for evaluating calls into the page. */
fun jsString(s: String): String = Json.encodeToString(kotlinx.serialization.json.JsonPrimitive(s))

/** Sends commands to the editor of one screen (the formatting bar holds one). */
class EditorController {
    internal var eval: ((String) -> Unit)? = null

    fun exec(command: String, arg: String? = null) {
        eval?.invoke("OpenNoteEditor.exec(${jsString(command)}${if (arg != null) ", ${jsString(arg)}" else ""})")
    }

    fun flush() = eval?.invoke("OpenNoteEditor.flush()")
    fun focus() = eval?.invoke("OpenNoteEditor.focus()")
}

/**
 * The note body: the web editor in the platform's WebView, loaded once and kept, with the note swapped in by `load`.
 * Android: androidx.webkit WebView with the page served from the app's assets. iOS: WKWebView with the page from the bundle.
 */
@Composable
expect fun NoteBodyEditor(
    noteKey: String,
    html: String,
    dark: Boolean,
    visible: Boolean,
    controller: EditorController,
    onEvent: (EditorEvent) -> Unit,
    modifier: Modifier = Modifier,
)

/** The script that loads a note once the page is ready. */
internal fun loadScript(html: String, dark: Boolean) =
    "OpenNoteEditor.setTheme({dark: $dark}); OpenNoteEditor.load({html: ${jsString(html)}, editable: true, placeholder: '…'});"
