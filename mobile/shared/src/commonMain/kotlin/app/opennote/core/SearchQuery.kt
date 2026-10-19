package app.opennote.core

import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.minus
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime

/** A date range of `created:` / `updated:` (start inclusive, end exclusive), in ms since the epoch. */
data class DateRange(var after: Long? = null, var before: Long? = null)

/**
 * The search grammar, as parsed by server/src/store.ts (parseQuery): free words are prefix matched, "quoted phrases" exact.
 * Operators: tag: notebook: todo: resource: reminderTime: created: updated: sourceUrl: intitle: any:, and `-` to negate.
 */
data class SearchQuery(
    /** Positive FTS5 expression, or null when there is no free text. */
    val match: String?,
    /** FTS5 expression of terms that must not appear. */
    val exclude: String?,
    val tags: List<String>,
    val notTags: List<String>,
    val notebooks: List<String>,
    val notNotebooks: List<String>,
    val todo: Boolean?,
    val hasAttachment: Boolean?,
    val hasReminder: Boolean?,
    val created: DateRange,
    val updated: DateRange,
    val sourceUrl: List<String>,
) {
    companion object {
        private val ANY = Regex("(^|\\s)any:(?=\\s|$)", RegexOption.IGNORE_CASE)
        private val TERM = Regex("(-)?(\\w+:)?(?:\"([^\"]*)\"|(\\S+))")
        private val WORD_SPLIT = Regex("[^\\p{L}\\p{N}]+")

        fun parse(q: String, now: Instant = Clock.System.now(), zone: TimeZone = TimeZone.currentSystemDefault()): SearchQuery {
            val tags = mutableListOf<String>(); val notTags = mutableListOf<String>()
            val notebooks = mutableListOf<String>(); val notNotebooks = mutableListOf<String>()
            val sourceUrl = mutableListOf<String>()
            var todo: Boolean? = null; var hasAttachment: Boolean? = null; var hasReminder: Boolean? = null
            val created = DateRange(); val updated = DateRange()
            val anyMode = ANY.containsMatchIn(q)
            val positive = mutableListOf<String>(); val negative = mutableListOf<String>()
            for (m in TERM.findAll(ANY.replace(q, " "))) {
                val neg = m.groupValues[1] == "-"
                val op = m.groups[2]?.value?.dropLast(1)?.lowercase()
                val quoted = m.groups[3]?.value
                val value = (quoted ?: m.groups[4]?.value ?: "").trim()
                if (value.isEmpty()) continue
                when (op) {
                    "tag" -> (if (neg) notTags else tags).add(value)
                    "notebook" -> (if (neg) notNotebooks else notebooks).add(value)
                    "todo" -> todo = if (neg) value.lowercase() == "false" else value.lowercase() != "false"
                    "resource" -> hasAttachment = !neg
                    "remindertime" -> hasReminder = !neg
                    "sourceurl" -> sourceUrl.add(value)
                    "created", "updated" -> {
                        val ts = parseDate(value, now, zone)
                        if (ts != null) { val r = if (op == "created") created else updated; if (neg) r.before = ts else r.after = ts }
                    }
                    else -> {
                        val raw = if (op != null && op != "intitle") "$op:$value" else value
                        val col = if (op == "intitle") "title : " else ""
                        val terms = if (quoted != null) listOf("$col\"${raw.replace("\"", "")}\"")
                        else raw.split(WORD_SPLIT).filter { it.isNotEmpty() }.map { "$col\"$it\"*" }
                        (if (neg) negative else positive).addAll(terms)
                    }
                }
            }
            return SearchQuery(
                match = positive.takeIf { it.isNotEmpty() }?.joinToString(if (anyMode) " OR " else " "),
                exclude = negative.takeIf { it.isNotEmpty() }?.joinToString(" OR "),
                tags, notTags, notebooks, notNotebooks, todo, hasAttachment, hasReminder, created, updated, sourceUrl,
            )
        }

        private val ABS = Regex("^(\\d{4})(\\d{2})(\\d{2})(?:T(\\d{2})(\\d{2})(\\d{2}))?$")
        private val REL = Regex("^(day|week|month|year)(?:-(\\d+))?$", RegexOption.IGNORE_CASE)

        /** Start (local time) of a search date: 20240131, day, day-1, week, month-2, year… */
        fun parseDate(value: String, now: Instant, zone: TimeZone): Long? {
            ABS.matchEntire(value)?.let { m ->
                val g = m.groupValues
                val ldt = LocalDateTime(g[1].toInt(), g[2].toInt(), g[3].toInt(), g[4].ifEmpty { "0" }.toInt(), g[5].ifEmpty { "0" }.toInt(), g[6].ifEmpty { "0" }.toInt())
                return ldt.toInstant(zone).toEpochMilliseconds()
            }
            val m = REL.matchEntire(value) ?: return null
            val n = m.groupValues[2].ifEmpty { "0" }.toInt()
            val today = now.toLocalDateTime(zone).date
            val day: LocalDate = when (m.groupValues[1].lowercase()) {
                "day" -> today.minus(n, DateTimeUnit.DAY)
                "week" -> today.minus(today.dayOfWeek.isoDayNumber - 1, DateTimeUnit.DAY).minus(7 * n, DateTimeUnit.DAY)
                "month" -> LocalDate(today.year, today.month, 1).minus(n, DateTimeUnit.MONTH)
                else -> LocalDate(today.year - n, 1, 1)
            }
            return day.atStartOfDayIn(zone).toEpochMilliseconds()
        }
    }
}
