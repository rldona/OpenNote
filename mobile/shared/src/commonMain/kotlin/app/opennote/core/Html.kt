package app.opennote.core

import com.fleeksoft.ksoup.Ksoup
import com.fleeksoft.ksoup.nodes.Document
import com.fleeksoft.ksoup.nodes.Element
import com.fleeksoft.ksoup.nodes.TextNode

/** Note HTML helpers, the counterpart of server/src/html.ts. */
object Html {
    private val DROP = setOf("script", "style", "iframe", "object", "embed", "link", "meta", "form")
    private val BLOCK = "p,div,li,h1,h2,h3,h4,h5,h6,tr,blockquote,pre"
    private val ISO_DAY = Regex("^\\d{4}-\\d{2}-\\d{2}$")

    private fun fragment(html: String): Document = Ksoup.parseBodyFragment(html).apply {
        outputSettings().prettyPrint(false)
    }

    /** Plain text of a note body, for full-text search and list snippets. */
    fun toText(html: String): String {
        val doc = fragment(html)
        for (tag in DROP) doc.select(tag).remove()
        for (br in doc.select("br")) br.replaceWith(TextNode("\n"))
        for (el in doc.select(BLOCK)) el.appendText("\n")
        return doc.body().wholeText()
            .replace(Regex("[ \\t\\r\\u000C\\u000B]+"), " ")
            .replace(Regex("\\n\\s*\\n+"), "\n")
            .trim()
    }

    /**
     * Removes active content (scripts, event handlers, javascript: URLs, non-image data: URLs). HTML with nothing to remove is
     * returned exactly as given, so a note that arrives through sync is stored byte for byte and its content hash does not
     * change (docs/SYNC-FORMAT.md 3.5).
     */
    fun sanitize(html: String): String {
        val doc = fragment(html)
        var changed = false
        for (tag in DROP) doc.select(tag).let { if (it.isNotEmpty()) { it.remove(); changed = true } }
        for (el in doc.body().getAllElements()) {
            for (attr in el.attributes().toList()) {
                val name = attr.key.lowercase()
                val value = attr.value.trim().lowercase()
                val drop = name.startsWith("on") ||
                    ((name == "href" || name == "src") && (value.startsWith("javascript:") || value.startsWith("vbscript:"))) ||
                    (name == "src" && value.startsWith("data:") && !value.startsWith("data:image/"))
                if (drop) { el.removeAttr(attr.key); changed = true }
            }
        }
        return if (changed) doc.body().html() else html
    }

    fun snippet(text: String, max: Int = 160): String {
        val flat = text.replace(Regex("\\s+"), " ").trim()
        return if (flat.length > max) flat.substring(0, max) + "…" else flat
    }

    data class TaskItem(val idx: Int, val text: String, val checked: Boolean, val due: String?)

    /** Checklist items of a note, in document order. */
    fun extractTasks(html: String): List<TaskItem> =
        fragment(html).select("li[data-type=taskItem]").mapIndexed { idx, li ->
            val due = li.attr("data-due").takeIf { li.hasAttr("data-due") && ISO_DAY.matches(it) }
            // Nested task lists would repeat their text in the parent: only the item's own children count.
            val own = li.children().filter { !it.`is`("ul,ol") }
            val text = own.joinToString(" ") { it.text() }.replace(Regex("\\s+"), " ").trim()
            TaskItem(idx, text, li.attr("data-checked") == "true", due)
        }

    /** Rewrites the idx-th checklist item; null when there is no such item. */
    fun patchTaskItem(html: String, idx: Int, checked: Boolean? = null, due: String? = null, clearDue: Boolean = false): String? {
        val doc = fragment(html)
        val li: Element = doc.select("li[data-type=taskItem]").getOrNull(idx) ?: return null
        if (checked != null) li.attr("data-checked", checked.toString())
        if (clearDue) li.removeAttr("data-due") else if (due != null) li.attr("data-due", due)
        return doc.body().html()
    }

    fun escape(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
