package app.opennote.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.time.Clock
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

/**
 * Loads something from the store, and again whenever the data changes ([Repo.revision]) or a key does. Null until the first
 * load has finished.
 */
@Composable
fun <T> load(vararg keys: Any?, block: suspend Repo.() -> T): T? {
    val env = LocalApp.current
    val rev by env.repo.revision.collectAsState()
    var value by remember(*keys) { mutableStateOf<T?>(null) }
    LaunchedEffect(rev, *keys) { value = env.repo.block() }
    return value
}

/** Every screen starts the same way: a first row at least [TopRowHeight] tall, [ScreenTop] below the top of the screen. */
val ScreenTop = 8.dp
val TopRowHeight = 48.dp

/** A screen header: optional back arrow, a large title, an optional subtitle and actions on the right. */
@Composable
fun ScreenHeader(title: String, subtitle: String? = null, back: Boolean = false, actions: @Composable () -> Unit = {}) {
    val env = LocalApp.current
    Column(Modifier.fillMaxWidth().statusBarsPadding().padding(start = if (back) 4.dp else 20.dp, end = 8.dp, top = ScreenTop)) {
        // The title sits in the first row like every other screen's; a subtitle goes under it and does not move it.
        Row(Modifier.fillMaxWidth().heightIn(min = TopRowHeight), verticalAlignment = Alignment.CenterVertically) {
            if (back) IconButton(onClick = { env.nav.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, strings.back) }
            Text(
                title, Modifier.weight(1f), fontSize = 26.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(0.dp), verticalAlignment = Alignment.CenterVertically) { actions() }
        }
        if (subtitle != null) {
            Text(subtitle, Modifier.padding(start = if (back) 48.dp else 0.dp), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 6.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

fun nowMs() = Clock.System.now().toEpochMilliseconds()

/** "10:42", "ayer", "12 oct", "12 oct 2025": short dates for lists. */
fun shortDate(ms: Long): String {
    val zone = TimeZone.currentSystemDefault()
    val d = kotlin.time.Instant.fromEpochMilliseconds(ms).toLocalDateTime(zone)
    val today = Clock.System.now().toLocalDateTime(zone).date
    val months = if (strings.es) listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic")
    else listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    return when {
        d.date == today -> "${d.hour.toString().padStart(2, '0')}:${d.minute.toString().padStart(2, '0')}"
        d.date.year == today.year -> "${d.day} ${months[d.month.ordinal]}"
        else -> "${d.day} ${months[d.month.ordinal]} ${d.year}"
    }
}

/** "hace 3 min", "5 minutes ago"… */
fun ago(ms: Long): String {
    val min = ((nowMs() - ms) / 60_000).coerceAtLeast(0)
    val es = strings.es
    return when {
        min < 1 -> if (es) "ahora" else "just now"
        min < 60 -> if (es) "hace $min min" else "$min min ago"
        min < 1440 -> if (es) "hace ${min / 60} h" else "${min / 60} h ago"
        else -> if (es) "hace ${min / 1440} d" else "${min / 1440} d ago"
    }
}
