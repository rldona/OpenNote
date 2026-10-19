package app.opennote.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.core.ListFilter
import app.opennote.core.NoteInput
import app.opennote.core.NoteSummary
import app.opennote.ui.LocalApp
import app.opennote.ui.NoteListKind
import app.opennote.ui.Screen
import app.opennote.ui.ScreenHeader
import app.opennote.ui.load
import app.opennote.ui.shortDate
import app.opennote.ui.strings
import kotlinx.coroutines.launch

enum class Sort { UPDATED, CREATED, TITLE }

/** Search operators behind the quick filters (the same chips as the web list: web/src/App.tsx). */
private val FILTERS = listOf("todo:true", "resource:*", "reminderTime:*", "updated:week")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesScreen(kind: NoteListKind) {
    val env = LocalApp.current
    val s = strings
    var filters by remember(kind) { mutableStateOf(emptySet<String>()) }
    var sort by remember { mutableStateOf(Sort.UPDATED) }
    var refreshing by remember { mutableStateOf(false) }
    var confirmEmpty by remember { mutableStateOf(false) }
    val baseQuery = (kind as? NoteListKind.Saved)?.query ?: ""
    val notes = load(kind, filters) {
        read {
            listNotes(
                ListFilter(
                    notebookId = (kind as? NoteListKind.Notebook)?.id, tag = (kind as? NoteListKind.Tag)?.name,
                    q = (listOf(baseQuery) + filters).joinToString(" ").trim().ifEmpty { null },
                    trashed = kind == NoteListKind.Trash, templates = kind == NoteListKind.Templates,
                    pinned = kind == NoteListKind.Pinned, reminders = kind == NoteListKind.Reminders,
                ),
            )
        }
    }
    val shown = when (sort) {
        Sort.UPDATED -> notes
        Sort.CREATED -> notes?.sortedWith(compareByDescending<NoteSummary> { it.pinned }.thenByDescending { it.createdAt })
        Sort.TITLE -> notes?.sortedWith(compareByDescending<NoteSummary> { it.pinned }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.title })
    }
    val title = when (kind) {
        NoteListKind.All -> s.allNotes; NoteListKind.Pinned -> s.pinned; NoteListKind.Reminders -> s.reminders
        NoteListKind.Trash -> s.trash; NoteListKind.Templates -> s.templates
        is NoteListKind.Notebook -> kind.name; is NoteListKind.Tag -> "# ${kind.name}"; is NoteListKind.Saved -> kind.name
    }
    val selected = (env.nav.top as? Screen.Note)?.id

    Column(Modifier.fillMaxSize()) {
        ScreenHeader(title, shown?.let { s.notesCount(it.size) }, back = env.nav.stack.size > 1 && env.nav.stack.first() !is Screen.Notes) {
            if (kind == NoteListKind.Trash) {
                if (!notes.isNullOrEmpty()) TextButton(onClick = { confirmEmpty = true }) { Text(s.emptyTrash) }
            } else if (kind != NoteListKind.Templates) {
                IconButton(onClick = { env.newNote((kind as? NoteListKind.Notebook)?.id, (kind as? NoteListKind.Tag)?.name) }) { Icon(Icons.Filled.Add, s.newNote) }
            }
            var menu by remember { mutableStateOf(false) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, s.more) }
                DropdownMenu(menu, { menu = false }) {
                    for ((k, label) in listOf(Sort.UPDATED to s.sortUpdated, Sort.CREATED to s.sortCreated, Sort.TITLE to s.sortTitle)) {
                        DropdownMenuItem(text = { Text((if (sort == k) "✓  " else "     ") + label) }, onClick = { sort = k; menu = false })
                    }
                    if (env.repo.engine != null) {
                        HorizontalDivider()
                        DropdownMenuItem(text = { Text(s.syncNow) }, leadingIcon = { Icon(Icons.Filled.Refresh, null) }, onClick = { menu = false; env.scope.launch { env.repo.sync() } })
                    }
                }
            }
        }
        if (kind != NoteListKind.Trash && kind != NoteListKind.Templates) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((op, label) in FILTERS.zip(listOf(s.filterOpenTasks, s.filterFiles, s.filterReminder, s.filterWeek))) {
                    FilterChip(selected = op in filters, onClick = { filters = if (op in filters) filters - op else filters + op }, label = { Text(label) })
                }
            }
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { env.scope.launch { refreshing = true; env.repo.sync() ?: env.repo.changed(); refreshing = false } },
            modifier = Modifier.weight(1f),
        ) {
            if (shown != null && shown.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(s.noNotes, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                items(shown ?: emptyList(), key = { it.id }) { n ->
                    NoteRow(n, selected = n.id == selected, trash = kind == NoteListKind.Trash)
                }
            }
        }
    }

    if (confirmEmpty) {
        AlertDialog(
            onDismissRequest = { confirmEmpty = false },
            text = { Text(s.confirmEmptyTrash) },
            confirmButton = { TextButton(onClick = { confirmEmpty = false; env.scope.launch { env.repo.write { emptyTrash() } } }) { Text(s.emptyTrash, color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmEmpty = false }) { Text(s.cancel) } },
        )
    }
}

/** A note in a list. Swipe right to pin or unpin (restore, in the trash), left to move it to the trash (delete, in the trash). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteRow(n: NoteSummary, selected: Boolean = false, trash: Boolean = false) {
    val env = LocalApp.current
    val s = strings
    val state = rememberSwipeToDismissBoxState()
    SwipeToDismissBox(
        state = state,
        onDismiss = { value ->
            env.scope.launch {
                when {
                    value == SwipeToDismissBoxValue.StartToEnd && trash -> { env.repo.write { restoreNote(n.id) }; env.message(s.restored) }
                    value == SwipeToDismissBoxValue.StartToEnd -> env.repo.write { updateNote(n.id, NoteInput(pinned = !n.pinned)) }
                    trash -> env.repo.write { deleteNotePermanently(n.id) }
                    else -> { env.repo.write { trashNote(n.id) }; env.message(s.movedToTrash) }
                }
                state.reset()
            }
        },
        backgroundContent = {
            val toEnd = state.dismissDirection == SwipeToDismissBoxValue.StartToEnd
            val color = if (toEnd) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
            Row(
                Modifier.fillMaxSize().background(color).padding(horizontal = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = if (toEnd) Arrangement.Start else Arrangement.End,
            ) {
                val label = when { toEnd && trash -> s.restore; toEnd -> if (n.pinned) s.unpin else s.pin; trash -> s.deleteForever; else -> s.delete }
                Icon(if (toEnd) Icons.Filled.Star else Icons.Filled.Delete, null, tint = Color.White)
                Text("  $label", color = Color.White, fontWeight = FontWeight.SemiBold)
            }
        },
    ) {
        Column(
            Modifier.fillMaxWidth()
                // Opaque: the swipe actions are drawn underneath.
                .background(if (selected) MaterialTheme.colorScheme.primaryContainer.compositeOver(MaterialTheme.colorScheme.background) else MaterialTheme.colorScheme.background)
                .clickable { env.nav.push(Screen.Note(n.id)) }
                .padding(horizontal = 20.dp, vertical = 12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (n.pinned) Icon(Icons.Filled.Star, s.pinned, Modifier.size(14.dp).padding(end = 2.dp), tint = MaterialTheme.colorScheme.primary)
                Text(n.title.ifEmpty { s.untitled }, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (n.reminderAt != null) Icon(Icons.Filled.Notifications, s.reminder, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (n.snippet.isNotEmpty()) Text(n.snippet, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(shortDate(n.updatedAt), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                for (t in n.tags.take(3)) {
                    Text(t, fontSize = 12.sp, modifier = Modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh, androidx.compose.foundation.shape.RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 1.dp))
                }
            }
        }
    }
    HorizontalDivider(Modifier.padding(start = 20.dp), color = MaterialTheme.colorScheme.outlineVariant)
}
