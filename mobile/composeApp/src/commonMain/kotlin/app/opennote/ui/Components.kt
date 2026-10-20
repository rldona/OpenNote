package app.opennote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
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

/**
 * A screen header: a back arrow (or the account button on top-level screens), a large title, an optional subtitle and
 * actions on the right.
 */
@Composable
fun ScreenHeader(title: String, subtitle: String? = null, back: Boolean = false, account: Boolean = false, actions: @Composable () -> Unit = {}) {
    val env = LocalApp.current
    Column(Modifier.fillMaxWidth().statusBarsPadding().padding(start = if (back || account) 4.dp else 20.dp, end = 8.dp, top = ScreenTop)) {
        // The title sits in the first row like every other screen's; a subtitle goes under it and does not move it.
        Row(Modifier.fillMaxWidth().heightIn(min = TopRowHeight), verticalAlignment = Alignment.CenterVertically) {
            if (back) IconButton(onClick = { env.nav.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, strings.back) }
            else if (account) { AccountButton(); Spacer(Modifier.width(8.dp)) }
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

/** "1350 NOTES": the count over a list, with a hairline under it. */
@Composable
fun ListCaption(text: String) {
    Text(
        text.uppercase(), Modifier.padding(start = 20.dp, top = 10.dp, bottom = 10.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.2.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

/**
 * The round button at the top left of the main screens: this device and its sync, What's new, the trash, settings and help.
 */
@Composable
fun AccountButton() {
    val env = LocalApp.current
    val s = strings
    val c = MaterialTheme.colorScheme
    val uri = LocalUriHandler.current
    val connected by AppCore.connected.collectAsState()
    val status by env.repo.syncStatus.collectAsState()
    var open by remember { mutableStateOf(false) }
    Box {
        Box(
            Modifier.padding(4.dp).size(40.dp).clip(CircleShape).background(c.primaryContainer).clickable { open = true },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Person, s.account, tint = c.primary)
            // A dot when the last sync went wrong.
            if (status?.ok == false) Box(Modifier.align(Alignment.TopEnd).size(10.dp).clip(CircleShape).background(c.error))
        }
        DropdownMenu(open, { open = false }, shape = RoundedCornerShape(18.dp)) {
            Row(
                Modifier.widthIn(min = 260.dp).clickable { open = false; env.nav.push(Screen.SettingsSection(SettingsPage.SYNC)) }.padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(40.dp).clip(CircleShape).background(c.primaryContainer), contentAlignment = Alignment.Center) {
                    Icon(if (connected) Icons.Outlined.CloudDone else Icons.Outlined.PhoneAndroid, null, tint = c.primary)
                }
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(if (connected) s.googleDrive else s.deviceName, fontWeight = FontWeight.SemiBold, color = c.onSurface)
                    val st = status
                    Text(
                        when {
                            !connected -> s.notSyncing
                            st == null -> s.driveConnected
                            st.ok -> s.syncedAt(ago(st.lastRunAt ?: 0))
                            else -> s.syncProblem
                        },
                        fontSize = 13.sp, color = if (st?.ok == false && connected) c.error else c.onSurfaceVariant, maxLines = 2,
                    )
                }
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.onSurfaceVariant)
            }
            HorizontalDivider(color = c.outlineVariant)
            DropdownMenuItem(text = { Text(s.whatsNew) }, leadingIcon = { Icon(Icons.Outlined.Campaign, null) }, onClick = { open = false; runCatching { uri.openUri(CHANGELOG_URL) } })
            DropdownMenuItem(text = { Text(s.trash) }, leadingIcon = { Icon(Icons.Outlined.Delete, null) }, onClick = { open = false; env.nav.push(Screen.Notes(NoteListKind.Trash)) })
            DropdownMenuItem(text = { Text(s.settings) }, leadingIcon = { Icon(Icons.Outlined.Settings, null) }, onClick = { open = false; env.nav.push(Screen.Settings) })
            DropdownMenuItem(text = { Text(s.help) }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.HelpOutline, null) }, onClick = { open = false; runCatching { uri.openUri(HELP_URL) } })
        }
    }
}

const val CHANGELOG_URL = "https://github.com/rldona/OpenNote/blob/main/CHANGELOG.md"
const val HELP_URL = "https://github.com/rldona/OpenNote#readme"

/** "08/07/2024": the dates of note lists. */
fun listDate(ms: Long): String {
    val d = kotlin.time.Instant.fromEpochMilliseconds(ms).toLocalDateTime(TimeZone.currentSystemDefault()).date
    val dd = d.day.toString().padStart(2, '0')
    val mm = (d.month.ordinal + 1).toString().padStart(2, '0')
    return if (strings.es) "$dd/$mm/${d.year}" else "$mm/$dd/${d.year}"
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
