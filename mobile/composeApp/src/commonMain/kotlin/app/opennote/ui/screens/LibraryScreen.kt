package app.opennote.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Create
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.core.Notebook
import app.opennote.ui.LocalApp
import app.opennote.ui.LocalBarSpace
import app.opennote.ui.NoteListKind
import app.opennote.ui.Screen
import app.opennote.ui.ScreenHeader
import app.opennote.ui.SectionTitle
import app.opennote.ui.load
import app.opennote.ui.strings
import kotlinx.coroutines.launch

/**
 * "More": what the web sidebar holds. Shortcuts, notebooks grouped in stacks, tags, and the other lists, plus settings.
 */
@Composable
fun LibraryScreen() {
    val env = LocalApp.current
    val s = strings
    data class Lib(val notebooks: List<Notebook>, val tags: List<app.opennote.core.TagCount>, val searches: List<app.opennote.core.SavedSearch>)
    val lib = load { read { Lib(listNotebooks(), listTags(), listSavedSearches()) } }
    var edit by remember { mutableStateOf<Notebook?>(null) }
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Notebook?>(null) }
    fun open(k: NoteListKind) = env.nav.push(Screen.Notes(k))

    Column(Modifier.fillMaxSize()) {
        ScreenHeader(s.more)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp + LocalBarSpace.current)) {
            item {
                Entry(Icons.Filled.List, s.allNotes) { open(NoteListKind.All) }
                Entry(Icons.Filled.Star, s.pinned) { open(NoteListKind.Pinned) }
                Entry(Icons.Filled.CheckCircle, s.tasks) { env.nav.push(Screen.Tasks) }
                Entry(Icons.Filled.Notifications, s.reminders) { open(NoteListKind.Reminders) }
                Entry(Icons.Outlined.Create, s.templates) { open(NoteListKind.Templates) }
            }
            val l = lib ?: return@LazyColumn
            if (l.searches.isNotEmpty()) {
                item { SectionTitle(s.savedSearches) }
                items(l.searches) { sv -> Entry(Icons.Filled.Search, sv.name) { open(NoteListKind.Saved(sv.name, sv.query)) } }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SectionTitle(s.notebooks, Modifier.weight(1f))
                    IconButton(onClick = { creating = true }, Modifier.padding(top = 12.dp, end = 8.dp)) { Icon(Icons.Filled.Add, s.newNotebook) }
                }
            }
            // Stacks first, then loose notebooks, as in the web sidebar.
            val groups = l.notebooks.groupBy { it.stack ?: "" }.toList().sortedWith(compareBy({ it.first.isEmpty() }, { it.first.lowercase() }))
            for ((stack, books) in groups) {
                if (stack.isNotEmpty()) item { Text(stack, Modifier.padding(start = 20.dp, top = 10.dp, bottom = 2.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
                items(books, key = { it.id }) { nb ->
                    Entry(null, nb.name, count = nb.noteCount, indent = stack.isNotEmpty(), onLong = { edit = nb }) { open(NoteListKind.Notebook(nb.id, nb.name)) }
                }
            }
            val tags = l.tags.filter { !it.virtual || it.total > 0 }
            if (tags.isNotEmpty()) {
                item { SectionTitle(s.tags) }
                items(tags, key = { "tag:${it.name}" }) { t ->
                    val depth = t.name.count { it == '/' }
                    Entry(null, "# " + t.name.substringAfterLast('/'), count = t.total, indentLevel = depth) { open(NoteListKind.Tag(t.name)) }
                }
            }
            item {
                HorizontalDivider(Modifier.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.outlineVariant)
                Entry(Icons.Filled.Delete, s.trash) { open(NoteListKind.Trash) }
                Entry(Icons.Filled.Settings, s.settings) { env.nav.push(Screen.Settings) }
            }
        }
    }

    if (creating || edit != null) NotebookDialog(edit, onClose = { creating = false; edit = null }, onDelete = { deleting = it; edit = null })
    deleting?.let { nb ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            text = { Text(s.confirmNotebook) },
            confirmButton = { TextButton(onClick = { deleting = null; env.scope.launch { runCatching { env.repo.write { deleteNotebook(nb.id) } }.onFailure { env.message(it.message ?: "") } } }) { Text(s.delete, color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(s.cancel) } },
        )
    }
}

@Composable
internal fun Entry(icon: ImageVector?, label: String, count: Int? = null, indent: Boolean = false, indentLevel: Int = 0, onLong: (() -> Unit)? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(start = 20.dp + (if (indent) 16.dp else 0.dp) + (16 * indentLevel).dp, end = 12.dp).padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(label, Modifier.weight(1f), fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (count != null) Text("$count", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (onLong != null) Icon(Icons.Filled.Edit, strings.rename, Modifier.size(36.dp).clickable(onClick = onLong).padding(8.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Create a notebook, or rename one and change its stack. */
@Composable
internal fun NotebookDialog(nb: Notebook?, onClose: () -> Unit, onDelete: (Notebook) -> Unit) {
    val env = LocalApp.current
    val s = strings
    var name by remember { mutableStateOf(nb?.name ?: "") }
    var stack by remember { mutableStateOf(nb?.stack ?: "") }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(if (nb == null) s.newNotebook else s.rename) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text(s.notebookName) }, singleLine = true)
                OutlinedTextField(stack, { stack = it }, label = { Text(s.stack) }, singleLine = true)
                if (nb != null) TextButton(onClick = { onDelete(nb) }) { Text(s.delete, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(enabled = name.isNotBlank(), onClick = {
                env.scope.launch {
                    env.repo.write {
                        if (nb == null) createNotebook(name, stack.ifBlank { null })
                        else updateNotebook(nb.id, name = name, stack = stack.ifBlank { null }, clearStack = stack.isBlank())
                    }
                }
                onClose()
            }) { Text(s.save) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(s.cancel) } },
    )
}
