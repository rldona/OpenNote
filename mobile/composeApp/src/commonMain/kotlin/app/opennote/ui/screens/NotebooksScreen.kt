package app.opennote.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.automirrored.outlined.NoteAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.core.Notebook
import app.opennote.ui.BrandGreen
import app.opennote.ui.ListCaption
import app.opennote.ui.LocalApp
import app.opennote.ui.NoteListKind
import app.opennote.ui.Screen
import app.opennote.ui.ScreenHeader
import app.opennote.ui.load
import app.opennote.ui.strings
import kotlinx.coroutines.launch

/** Notebooks, grouped in their stacks, with the number of notes in each. Long press to rename, move or delete. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NotebooksScreen() {
    val env = LocalApp.current
    val s = strings
    val notebooks = load { read { listNotebooks() } }
    var edit by remember { mutableStateOf<Notebook?>(null) }
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Notebook?>(null) }
    val root = env.nav.stack.size == 1
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader(s.notebooks, back = !root, account = root) {
                IconButton(onClick = { env.nav.push(Screen.Search) }) { Icon(Icons.Filled.Search, s.search) }
            }
            val list = notebooks ?: return@Column
            ListCaption(s.notebooksCount(list.size))
            // Stacks first, then loose notebooks, as in the web sidebar.
            val groups = list.groupBy { it.stack ?: "" }.toList().sortedWith(compareBy({ it.first.isEmpty() }, { it.first.lowercase() }))
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                for ((stack, books) in groups) {
                    if (stack.isNotEmpty()) item(key = "stack:$stack") {
                        Text(stack.uppercase(), Modifier.padding(start = 20.dp, top = 16.dp, bottom = 4.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    items(books, key = { it.id }) { nb ->
                        Row(
                            Modifier.fillMaxWidth()
                                .combinedClickable(onLongClick = { edit = nb }) { env.nav.push(Screen.Notes(NoteListKind.Notebook(nb.id, nb.name))) }
                                .padding(start = 20.dp, end = 8.dp, top = 14.dp, bottom = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Outlined.Book, null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(nb.name, Modifier.padding(start = 16.dp).weight(1f, fill = false), fontSize = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("  ${nb.noteCount}", Modifier.weight(1f), fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            IconButton(onClick = { edit = nb }) { Icon(Icons.Outlined.Edit, s.rename, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
        FloatingActionButton(
            onClick = { creating = true }, Modifier.align(Alignment.BottomEnd).padding(16.dp),
            containerColor = BrandGreen, contentColor = Color.White, shape = androidx.compose.foundation.shape.CircleShape,
        ) { Icon(Icons.AutoMirrored.Outlined.NoteAdd, s.newNotebook) }
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

/** Tags, nested by "/", with their note counts. */
@Composable
fun TagsScreen() {
    val env = LocalApp.current
    val s = strings
    val tags = load { read { listTags() } }?.filter { !it.virtual || it.total > 0 }
    val root = env.nav.stack.size == 1
    Column(Modifier.fillMaxSize()) {
        ScreenHeader(s.tags, back = !root, account = root)
        val list = tags ?: return@Column
        ListCaption(s.tagsCount(list.size))
        if (list.isEmpty()) Text(s.noTags, Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            items(list, key = { it.name }) { t ->
                val depth = t.name.count { it == '/' }
                Row(
                    Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background)
                        .clickable { env.nav.push(Screen.Notes(NoteListKind.Tag(t.name))) }
                        .padding(start = 20.dp + (18 * depth).dp, end = 20.dp, top = 14.dp, bottom = 14.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Label, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(t.name.substringAfterLast('/'), Modifier.weight(1f), fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${t.total}", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}
