package app.opennote.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.core.NoteStore
import app.opennote.ui.LocalApp
import app.opennote.ui.LocalBarSpace
import app.opennote.ui.Screen
import app.opennote.ui.ScreenHeader
import app.opennote.ui.SectionTitle
import app.opennote.ui.load
import app.opennote.ui.strings
import kotlin.time.Clock
import kotlinx.coroutines.launch
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime

/** Every checklist item of every note, grouped by due date like the web Tasks view. */
@Composable
fun TasksScreen() {
    val env = LocalApp.current
    val s = strings
    var done by remember { mutableStateOf(false) }
    val tasks = load(done) { read { listTasks(if (done) NoteStore.TaskStatus.DONE else NoteStore.TaskStatus.OPEN) } } ?: emptyList()
    val today = Clock.System.now().toLocalDateTime(TimeZone.currentSystemDefault()).date
    val week = today.plus(7, DateTimeUnit.DAY).toString()
    val t = today.toString()
    val groups = if (done) listOf("" to tasks) else listOf(
        s.overdue to tasks.filter { it.due != null && it.due!! < t },
        s.today to tasks.filter { it.due == t },
        s.next7 to tasks.filter { it.due != null && it.due!! > t && it.due!! <= week },
        s.later to tasks.filter { it.due != null && it.due!! > week },
        s.noDate to tasks.filter { it.due == null },
    ).filter { it.second.isNotEmpty() }

    Column(Modifier.fillMaxSize()) {
        ScreenHeader(s.tasks, back = env.nav.canGoBack)
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(!done, { done = false }, { Text(s.open) })
            FilterChip(done, { done = true }, { Text(s.done) })
        }
        if (tasks.isEmpty()) Text(s.noTasks, Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp + LocalBarSpace.current)) {
            for ((label, items) in groups) {
                if (label.isNotEmpty()) item { SectionTitle("$label · ${items.size}") }
                items(items, key = { "${it.noteId}:${it.idx}" }) { task ->
                    Row(Modifier.fillMaxWidth().clickable { env.nav.push(Screen.Note(task.noteId)) }.padding(start = 8.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(task.checked, { env.scope.launch { env.repo.write { updateTask(task.noteId, task.idx, checked = !task.checked) } } })
                        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                            Text(task.text.ifEmpty { "…" }, textDecoration = if (task.checked) TextDecoration.LineThrough else null, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(listOfNotNull(task.due, task.noteTitle.ifEmpty { s.untitled }).joinToString(" · "), fontSize = 12.sp,
                                color = if (!task.checked && task.due != null && task.due!! < t) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}
