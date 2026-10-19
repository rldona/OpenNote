package app.opennote.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.core.Note
import app.opennote.core.NoteInput
import app.opennote.ui.EditorController
import app.opennote.ui.EditorEvent
import app.opennote.ui.EditorState
import app.opennote.ui.LocalApp
import androidx.compose.foundation.layout.heightIn
import app.opennote.ui.TopRowHeight
import app.opennote.ui.ScreenTop
import app.opennote.ui.LocalSettled
import app.opennote.ui.NoteBodyEditor
import app.opennote.ui.Screen
import app.opennote.ui.isDarkTheme
import app.opennote.ui.load
import app.opennote.ui.strings
import kotlin.time.Instant
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime

/**
 * A note: header (notebook, pin, reminder, menu), title, tags, the web editor for the body and the native formatting bar
 * above the keyboard. Every change is saved after a short pause, like the web editor.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteScreen(id: String) {
    val env = LocalApp.current
    val s = strings
    // Bumped when the body changes from outside the editor (a restored version), so the editor reloads it.
    var bodyRev by remember(id) { mutableIntStateOf(0) }
    var initial by remember(id) { mutableStateOf<Note?>(null) }
    LaunchedEffect(id, bodyRev) { initial = runCatching { env.repo.read { getNote(id) } }.getOrNull() }
    val note = load(id) { runCatching { read { getNote(id) } }.getOrNull() }
    val notebooks = load { read { listNotebooks() } } ?: emptyList()
    val start = initial ?: return
    val current = note ?: start
    val trashed = current.summary.trashedAt != null

    val controller = remember(id) { EditorController() }
    var state by remember(id) { mutableStateOf(EditorState()) }
    var title by remember(id, bodyRev) { mutableStateOf(start.title) }
    var saveJob by remember(id) { mutableStateOf<Job?>(null) }
    var showHistory by remember { mutableStateOf(false) }
    var showReminder by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val uri = LocalUriHandler.current

    fun save(patch: NoteInput) {
        saveJob?.cancel()
        saveJob = env.scope.launch {
            delay(600)
            env.repo.write { updateNote(id, patch) }
        }
    }

    Column(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
        // ---- header
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = ScreenTop).heightIn(min = TopRowHeight), verticalAlignment = Alignment.CenterVertically) {
            if (!env.wide || env.nav.stack.size > 1 && env.nav.stack[env.nav.stack.lastIndex - 1] !is Screen.Notes) {
                IconButton(onClick = { controller.flush(); env.nav.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, s.back) }
            }
            NotebookPicker(current, notebooks, enabled = !trashed)
            Spacer(Modifier.weight(1f))
            if (!trashed) {
                IconButton(onClick = { showReminder = true }) {
                    Icon(if (current.summary.reminderAt != null) Icons.Filled.Notifications else Icons.Outlined.Notifications, s.reminder,
                        tint = if (current.summary.reminderAt != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { env.scope.launch { env.repo.write { updateNote(id, NoteInput(pinned = !current.summary.pinned)) } } }) {
                    Icon(if (current.summary.pinned) Icons.Filled.Star else Icons.Outlined.Star, if (current.summary.pinned) s.unpin else s.pin,
                        tint = if (current.summary.pinned) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            var menu by remember { mutableStateOf(false) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, s.more) }
                DropdownMenu(menu, { menu = false }) {
                    if (trashed) {
                        DropdownMenuItem(text = { Text(s.restore) }, onClick = { menu = false; env.scope.launch { env.repo.write { restoreNote(id) } } })
                        DropdownMenuItem(text = { Text(s.deleteForever, color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; confirmDelete = true })
                    } else {
                        DropdownMenuItem(text = { Text(s.history) }, onClick = { menu = false; showHistory = true })
                        DropdownMenuItem(text = { Text(s.duplicate) }, onClick = {
                            menu = false
                            env.scope.launch { val copy = env.repo.write { duplicateNote(id) }; env.nav.push(Screen.Note(copy.id)) }
                        })
                        DropdownMenuItem(text = { Text(s.saveAsTemplate) }, onClick = {
                            menu = false
                            env.scope.launch { env.repo.write { saveAsTemplate(id) }; env.message(s.templateSaved) }
                        })
                        HorizontalDivider()
                        DropdownMenuItem(text = { Text(s.delete, color = MaterialTheme.colorScheme.error) }, onClick = {
                            menu = false
                            env.scope.launch { env.repo.write { trashNote(id) }; env.message(s.movedToTrash); env.nav.back() }
                        })
                    }
                }
            }
        }
        // ---- title and tags
        BasicTextField(
            value = title,
            onValueChange = { title = it; save(NoteInput(title = it)) },
            readOnly = trashed,
            textStyle = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            decorationBox = { inner ->
                Box { if (title.isEmpty()) Text(s.title, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant); inner() }
            },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        )
        TagsRow(current, enabled = !trashed)
        // ---- body
        NoteBodyEditor(
            noteKey = "$id:$bodyRev",
            html = start.content,
            dark = isDarkTheme(env.theme),
            visible = LocalSettled.current,
            editable = !trashed,
            controller = controller,
            onEvent = { e ->
                when (e) {
                    is EditorEvent.State -> state = e.state
                    is EditorEvent.Change -> env.scope.launch { env.repo.write { updateNote(id, NoteInput(content = e.html)) } }
                    is EditorEvent.Link -> {
                        val target = Regex("#/note/([\\w-]+)").find(e.href)?.groupValues?.get(1)
                        if (target != null) env.nav.push(Screen.Note(target)) else runCatching { uri.openUri(e.href) }
                    }
                    EditorEvent.Ready -> Unit
                }
            },
            modifier = Modifier.weight(1f).fillMaxWidth(),
        )
        if (!trashed) FormatBar(state, controller)
    }

    if (showHistory) HistoryDialog(id, onRestored = { bodyRev++ }) { showHistory = false }
    if (showReminder) ReminderDialog(current) { showReminder = false }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            text = { Text(s.confirmDelete) },
            confirmButton = { TextButton(onClick = { confirmDelete = false; env.scope.launch { env.repo.write { deleteNotePermanently(id) }; env.nav.back() } }) { Text(s.deleteForever, color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(s.cancel) } },
        )
    }
}

@Composable
private fun NotebookPicker(note: Note, notebooks: List<app.opennote.core.Notebook>, enabled: Boolean) {
    val env = LocalApp.current
    var open by remember { mutableStateOf(false) }
    val nb = notebooks.firstOrNull { it.id == note.notebookId }
    Box {
        Row(
            Modifier.clip(RoundedCornerShape(10.dp)).clickable(enabled = enabled) { open = true }.padding(horizontal = 10.dp, vertical = 8.dp).widthIn(max = 220.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val label = listOfNotNull(nb?.stack, nb?.name).joinToString(" › ")
            Text(label, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (enabled) Icon(Icons.Filled.ArrowDropDown, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(open, { open = false }) {
            for (b in notebooks) DropdownMenuItem(
                text = { Text(listOfNotNull(b.stack, b.name).joinToString(" › ")) },
                onClick = { open = false; env.scope.launch { env.repo.write { updateNote(note.id, NoteInput(notebookId = b.id)) } } },
            )
        }
    }
}

@Composable
private fun TagsRow(note: Note, enabled: Boolean) {
    val env = LocalApp.current
    val s = strings
    var input by remember(note.id) { mutableStateOf("") }
    fun add() {
        val name = input.trim().trimEnd(',')
        input = ""
        if (name.isNotEmpty() && note.tags.none { it.equals(name, ignoreCase = true) }) {
            env.scope.launch { env.repo.write { updateNote(note.id, NoteInput(tags = note.tags + name)) } }
        }
    }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        for (t in note.tags) {
            Row(Modifier.clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(start = 10.dp, end = if (enabled) 2.dp else 10.dp, top = 2.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(t, fontSize = 13.sp)
                if (enabled) Icon(Icons.Filled.Close, "${s.delete} $t", Modifier.size(28.dp).clip(RoundedCornerShape(50)).clickable {
                    env.scope.launch { env.repo.write { updateNote(note.id, NoteInput(tags = note.tags - t)) } }
                }.padding(7.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (enabled) BasicTextField(
            value = input,
            onValueChange = { v -> if (v.endsWith(",")) { input = v; add() } else input = v },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { add() }),
            textStyle = TextStyle(fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            decorationBox = { inner -> Box { if (input.isEmpty()) Text(s.addTag, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant); inner() } },
            modifier = Modifier.widthIn(min = 120.dp).padding(vertical = 6.dp),
        )
    }
}

/** The native formatting bar, one row that scrolls sideways, right above the keyboard. */
@Composable
private fun FormatBar(state: EditorState, controller: EditorController) {
    val s = strings
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).navigationBarsPadding()) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            var styleMenu by remember { mutableStateOf(false) }
            Box {
                BarButton("Aa", s.textStyle, state.heading1 || state.heading2 || state.blockquote || state.codeBlock) { styleMenu = true }
                DropdownMenu(styleMenu, { styleMenu = false }) {
                    for ((label, cmd, on) in listOf(
                        Triple(s.paragraph, "paragraph", state.paragraph && !state.heading1 && !state.heading2),
                        Triple(s.heading1, "heading1", state.heading1), Triple(s.heading2, "heading2", state.heading2),
                        Triple(s.quote, "blockquote", state.blockquote), Triple(s.code, "codeBlock", state.codeBlock),
                        Triple(s.strike, "strike", state.strike), Triple(s.highlight, "highlight", state.highlight),
                    )) DropdownMenuItem(text = { Text((if (on) "✓  " else "     ") + label) }, onClick = { styleMenu = false; controller.exec(cmd) })
                }
            }
            BarButton("B", s.bold, state.bold) { controller.exec("bold") }
            BarButton("I", s.italic, state.italic) { controller.exec("italic") }
            BarButton("U", s.underline, state.underline) { controller.exec("underline") }
            BarButton("☑", s.checklist, state.taskList) { controller.exec("taskList") }
            BarButton("•", s.bullets, state.bulletList) { controller.exec("bulletList") }
            BarButton("1.", s.numbers, state.orderedList) { controller.exec("orderedList") }
            var insertMenu by remember { mutableStateOf(false) }
            Box {
                BarButton("+", "+", false) { insertMenu = true }
                DropdownMenu(insertMenu, { insertMenu = false }) {
                    DropdownMenuItem(text = { Text(s.table) }, onClick = { insertMenu = false; controller.exec("table") })
                    DropdownMenuItem(text = { Text(s.divider) }, onClick = { insertMenu = false; controller.exec("rule") })
                }
            }
            BarButton("↶", s.undo, false) { controller.exec("undo") }
            BarButton("↷", s.redo, false) { controller.exec("redo") }
        }
    }
}

@Composable
private fun BarButton(label: String, description: String, active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(width = 46.dp, height = 44.dp).clip(RoundedCornerShape(10.dp))
            .background(if (active) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
            .clickable(onClickLabel = description, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun HistoryDialog(id: String, onRestored: () -> Unit, onClose: () -> Unit) {
    val env = LocalApp.current
    val s = strings
    val versions = load(id) { read { listVersions(id) } }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(s.history) },
        text = {
            if (versions.isNullOrEmpty()) Text(s.noHistory)
            else LazyColumn {
                items(versions) { v ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(v.title.ifEmpty { s.untitled }, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(app.opennote.ui.shortDate(v.savedAt), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        TextButton(onClick = { env.scope.launch { env.repo.write { restoreVersion(id, v.id) }; onRestored(); onClose() } }) { Text(s.restore) }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(s.cancel) } },
    )
}

/** Date, then time, for a reminder; or removing it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReminderDialog(note: Note, onClose: () -> Unit) {
    val env = LocalApp.current
    val s = strings
    val zone = TimeZone.currentSystemDefault()
    val existing = note.summary.reminderAt?.let { Instant.fromEpochMilliseconds(it).toLocalDateTime(zone) }
    val dateState = rememberDatePickerState(initialSelectedDateMillis = note.summary.reminderAt ?: app.opennote.ui.nowMs())
    var pickedDate by remember { mutableStateOf<Long?>(null) }
    if (pickedDate == null) {
        DatePickerDialog(
            onDismissRequest = onClose,
            confirmButton = { TextButton(onClick = { pickedDate = dateState.selectedDateMillis }) { Text(s.save) } },
            dismissButton = {
                Row {
                    if (note.summary.reminderAt != null) TextButton(onClick = {
                        env.scope.launch { env.repo.write { updateNote(note.id, NoteInput(clearReminder = true)) } }; onClose()
                    }) { Text(s.clearReminder) }
                    TextButton(onClick = onClose) { Text(s.cancel) }
                }
            },
        ) { DatePicker(dateState) }
    } else {
        val timeState = rememberTimePickerState(initialHour = existing?.hour ?: 9, initialMinute = existing?.minute ?: 0, is24Hour = true)
        AlertDialog(
            onDismissRequest = onClose,
            title = { Text(s.reminder) },
            text = { TimePicker(timeState) },
            confirmButton = {
                TextButton(onClick = {
                    // The date picker answers in UTC midnight of the chosen day.
                    val day = Instant.fromEpochMilliseconds(pickedDate!!).toLocalDateTime(TimeZone.UTC).date
                    val at = LocalDateTime(day.year, day.month, day.day, timeState.hour, timeState.minute).toInstant(zone).toEpochMilliseconds()
                    env.scope.launch { env.repo.write { updateNote(note.id, NoteInput(reminderAt = at)) } }
                    onClose()
                }) { Text(s.save) }
            },
            dismissButton = { TextButton(onClick = onClose) { Text(s.cancel) } },
        )
    }
}
