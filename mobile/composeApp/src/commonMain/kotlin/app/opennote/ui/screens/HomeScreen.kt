package app.opennote.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import app.opennote.ui.BrandGreen
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.core.ListFilter
import app.opennote.core.NoteStore
import app.opennote.ui.LocalApp
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Box
import app.opennote.ui.TopRowHeight
import app.opennote.ui.ScreenTop
import app.opennote.ui.NoteListKind
import app.opennote.ui.Screen
import app.opennote.ui.load
import app.opennote.ui.shortDate
import app.opennote.ui.strings
import kotlin.time.Clock
import kotlinx.coroutines.launch
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime

/** Home: a greeting, quick capture, and what needs attention (the web Home's widgets, one column on phones). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen() {
    val env = LocalApp.current
    val s = strings
    data class HomeData(val tasks: List<app.opennote.core.Task>, val reminders: List<app.opennote.core.NoteSummary>, val pinned: List<app.opennote.core.NoteSummary>, val recent: List<app.opennote.core.NoteSummary>, val notebooks: List<app.opennote.core.Notebook>, val tags: List<app.opennote.core.TagCount>)
    val zone = TimeZone.currentSystemDefault()
    val today = Clock.System.now().toLocalDateTime(zone).date
    val soon = today.plus(7, DateTimeUnit.DAY).toString()
    val data = load {
        read {
            HomeData(
                listTasks(NoteStore.TaskStatus.OPEN).filter { it.due != null && it.due!! <= soon }.take(6),
                listNotes(ListFilter(reminders = true)).sortedBy { it.reminderAt }.take(5),
                listNotes(ListFilter(pinned = true)).take(6),
                listNotes(ListFilter(limit = 10)),
                listNotebooks(),
                listTags().filter { !it.virtual }.sortedByDescending { it.total }.take(12),
            )
        }
    }
    val hour = Clock.System.now().toLocalDateTime(zone).hour
    val greeting = when { hour < 6 -> s.goodEvening; hour < 13 -> s.goodMorning; hour < 21 -> s.goodAfternoon; else -> s.goodEvening }
    var draft by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(bottom = 24.dp)) {
        Box(Modifier.padding(start = 20.dp, top = ScreenTop, end = 20.dp).heightIn(min = TopRowHeight), contentAlignment = Alignment.CenterStart) {
            Text(greeting, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(draft, { draft = it }, Modifier.weight(1f), placeholder = { Text(s.captureHint) }, singleLine = true, shape = RoundedCornerShape(14.dp))
            FilledIconButton(
                onClick = { if (draft.isNotBlank()) { env.newNote(title = draft.trim()); draft = "" } }, Modifier.padding(start = 8.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = BrandGreen, contentColor = Color.White),
            ) { Icon(Icons.Filled.Add, s.newNote) }
        }
        val d = data ?: return@Column
        Card(s.upcomingTasks, onAll = { env.nav.push(Screen.Tasks) }) {
            if (d.tasks.isEmpty()) Muted(s.nothingDue)
            for (t in d.tasks) Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(false, { env.scope.launch { env.repo.write { updateTask(t.noteId, t.idx, checked = true) } } })
                Column(Modifier.weight(1f).clickable { env.nav.push(Screen.Note(t.noteId)) }) {
                    Text(t.text.ifEmpty { "…" }, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${if (t.due == today.toString()) s.today else t.due} · ${t.noteTitle.ifEmpty { s.untitled }}", fontSize = 12.sp,
                        color = if (t.due!! < today.toString()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
        }
        Card(s.reminders, onAll = { env.nav.push(Screen.Notes(NoteListKind.Reminders)) }) {
            if (d.reminders.isEmpty()) Muted(s.nothingScheduled)
            for (n in d.reminders) NoteLine(n.title.ifEmpty { s.untitled }, shortDate(n.reminderAt!!)) { env.nav.push(Screen.Note(n.id)) }
        }
        if (d.pinned.isNotEmpty()) Card(s.pinned, onAll = { env.nav.push(Screen.Notes(NoteListKind.Pinned)) }) {
            for (n in d.pinned) NoteLine(n.title.ifEmpty { s.untitled }, n.snippet) { env.nav.push(Screen.Note(n.id)) }
        }
        Card(s.notebooks, onAll = { env.nav.root(app.opennote.ui.Screen.Library) }) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (nb in d.notebooks.take(8)) Pill("${nb.name}  ${nb.noteCount}") { env.nav.push(Screen.Notes(NoteListKind.Notebook(nb.id, nb.name))) }
            }
        }
        if (d.recent.isNotEmpty()) {
            Text(s.recent, Modifier.padding(start = 20.dp, top = 20.dp, bottom = 8.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(d.recent, key = { it.id }) { n ->
                    Column(Modifier.width(240.dp).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceContainer).clickable { env.nav.push(Screen.Note(n.id)) }.padding(14.dp)) {
                        Text(n.title.ifEmpty { s.untitled }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(n.snippet, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Text(shortDate(n.updatedAt), Modifier.padding(top = 6.dp), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        if (d.tags.isNotEmpty()) Card(s.tags) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (t in d.tags) Pill("${t.name}  ${t.total}") { env.nav.push(Screen.Notes(NoteListKind.Tag(t.name))) }
            }
        }
    }
}

@Composable
private fun Card(title: String, onAll: (() -> Unit)? = null, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 14.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (onAll != null) TextButton(onClick = onAll) { Text(strings.showAll, fontSize = 13.sp) }
        }
        content()
    }
}

@Composable
private fun Muted(text: String) = Text(text, Modifier.padding(vertical = 6.dp), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun NoteLine(title: String, sub: String, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(vertical = 6.dp)) {
        Text(title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (sub.isNotEmpty()) Text(sub, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun Pill(text: String, onClick: () -> Unit) {
    Text(text, Modifier.clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp), fontSize = 14.sp)
}
