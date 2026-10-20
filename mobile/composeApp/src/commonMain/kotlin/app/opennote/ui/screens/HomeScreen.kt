package app.opennote.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.NotificationAdd
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.core.Html
import app.opennote.core.ListFilter
import app.opennote.core.NoteStore
import app.opennote.ui.AccountButton
import app.opennote.ui.BrandGreen
import app.opennote.ui.LocalApp
import app.opennote.ui.LocalBarSpace
import app.opennote.ui.NoteAction
import app.opennote.ui.NoteListKind
import app.opennote.ui.RecorderDialog
import app.opennote.ui.Screen
import app.opennote.ui.ScreenTop
import app.opennote.ui.SketchDialog
import app.opennote.ui.TaskViolet
import app.opennote.ui.TopRowHeight
import app.opennote.ui.load
import app.opennote.ui.rememberCapture
import app.opennote.ui.shortDate
import app.opennote.ui.strings
import kotlin.time.Clock
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime

/**
 * "Create": the day, search, the two big buttons (new note, new task), shortcuts to every way of capturing something, a
 * scratch pad, and below what needs attention (tasks due, reminders, pinned and recent notes).
 */
@Composable
fun HomeScreen() {
    val env = LocalApp.current
    val s = strings
    val c = MaterialTheme.colorScheme
    val capture = rememberCapture()
    data class HomeData(val tasks: List<app.opennote.core.Task>, val reminders: List<app.opennote.core.NoteSummary>, val pinned: List<app.opennote.core.NoteSummary>, val recent: List<app.opennote.core.NoteSummary>)
    val zone = TimeZone.currentSystemDefault()
    val now = Clock.System.now().toLocalDateTime(zone)
    val today = now.date
    val soon = today.plus(7, DateTimeUnit.DAY).toString()
    val data = load {
        read {
            HomeData(
                listTasks(NoteStore.TaskStatus.OPEN).filter { it.due != null && it.due!! <= soon }.take(6),
                listNotes(ListFilter(reminders = true)).sortedBy { it.reminderAt }.take(5),
                listNotes(ListFilter(pinned = true)).take(6),
                listNotes(ListFilter(limit = 10)),
            )
        }
    }
    var recording by remember { mutableStateOf(false) }
    var sketching by remember { mutableStateOf(false) }
    var creatingNotebook by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(bottom = 24.dp + LocalBarSpace.current)) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = ScreenTop).heightIn(min = TopRowHeight), verticalAlignment = Alignment.CenterVertically) {
            AccountButton()
        }
        Text(s.myOpenNote, Modifier.fillMaxWidth(), fontSize = 32.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Text(s.longDate(today.dayOfWeek.ordinal, today.day, today.month.ordinal, today.year), Modifier.fillMaxWidth().padding(top = 4.dp), fontSize = 16.sp, color = c.onSurfaceVariant, textAlign = TextAlign.Center)

        // Search: opens the search screen.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp).clip(RoundedCornerShape(14.dp))
                .border(1.dp, c.outline, RoundedCornerShape(14.dp)).clickable { env.nav.push(Screen.Search) }.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(s.findAnything, Modifier.weight(1f), color = c.onSurfaceVariant, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.Filled.Search, null, tint = c.onSurfaceVariant)
        }

        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            BigButton(s.newNote, BrandGreen, Modifier.weight(1f), { NoteArt() }) { env.newNote() }
            BigButton(s.newTask, TaskViolet, Modifier.weight(1f), { TaskArt() }) { env.newTask() }
        }

        val tiles = buildList {
            add(Triple(Icons.Outlined.Book, s.notebook) { creatingNotebook = true })
            add(Triple(Icons.Outlined.NotificationAdd, s.reminder) { env.newNote(action = NoteAction.REMINDER) })
            add(Triple(Icons.Outlined.Mic, s.recorder) { recording = true })
            add(Triple(Icons.Outlined.CameraAlt, s.camera) { capture.photo { f -> if (f != null) env.newNoteWith(listOf(f), s.photoTitle) } })
            if (capture.canScan) add(Triple(Icons.Outlined.DocumentScanner, s.scan) { capture.scan { env.newNoteWith(it, s.scanTitle) } })
            add(Triple(Icons.Outlined.AttachFile, s.files) { capture.files { files -> env.newNoteWith(files, files.singleOrNull()?.name ?: "") } })
            add(Triple(Icons.Outlined.Draw, s.sketch) { sketching = true })
            add(Triple(Icons.AutoMirrored.Outlined.Article, s.templates) { env.nav.push(Screen.Notes(NoteListKind.Templates)) })
        }
        LazyRow(Modifier.padding(top = 12.dp), contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(tiles) { (icon, label, action) -> Tile(icon, label, action) }
        }

        ScratchPad()

        val d = data ?: return@Column
        if (d.tasks.isNotEmpty()) Card(s.upcomingTasks, onAll = { env.nav.push(Screen.Tasks) }) {
            for (t in d.tasks) Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(false, { env.scope.launch { env.repo.write { updateTask(t.noteId, t.idx, checked = true) } } })
                Column(Modifier.weight(1f).clickable { env.nav.push(Screen.Note(t.noteId)) }) {
                    Text(t.text.ifEmpty { "…" }, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${if (t.due == today.toString()) s.today else t.due} · ${t.noteTitle.ifEmpty { s.untitled }}", fontSize = 12.sp,
                        color = if (t.due!! < today.toString()) c.error else c.onSurfaceVariant, maxLines = 1)
                }
            }
        }
        if (d.reminders.isNotEmpty()) Card(s.reminders, onAll = { env.nav.push(Screen.Notes(NoteListKind.Reminders)) }) {
            for (n in d.reminders) NoteLine(n.title.ifEmpty { s.untitled }, shortDate(n.reminderAt!!)) { env.nav.push(Screen.Note(n.id)) }
        }
        if (d.pinned.isNotEmpty()) Card(s.shortcuts, onAll = { env.nav.push(Screen.Notes(NoteListKind.Pinned)) }) {
            for (n in d.pinned) NoteLine(n.title.ifEmpty { s.untitled }, n.snippet) { env.nav.push(Screen.Note(n.id)) }
        }
        if (d.recent.isNotEmpty()) {
            Text(s.recent, Modifier.padding(start = 20.dp, top = 20.dp, bottom = 8.dp), fontSize = 18.sp, fontWeight = FontWeight.Bold)
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(d.recent, key = { it.id }) { n ->
                    Column(Modifier.width(220.dp).height(130.dp).clip(RoundedCornerShape(14.dp)).background(c.surfaceContainer).clickable { env.nav.push(Screen.Note(n.id)) }.padding(14.dp)) {
                        Text(n.title.ifEmpty { s.untitled }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(n.snippet, Modifier.weight(1f), fontSize = 13.sp, color = c.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Text(shortDate(n.updatedAt), fontSize = 12.sp, color = c.onSurfaceVariant)
                    }
                }
            }
        }
    }

    if (recording) RecorderDialog(onDone = { f -> recording = false; env.newNoteWith(listOf(f), s.audioTitle) }, onClose = { recording = false })
    if (sketching) SketchDialog(onDone = { f -> sketching = false; env.newNoteWith(listOf(f), s.sketch) }, onClose = { sketching = false })
    if (creatingNotebook) NotebookDialog(null, onClose = { creatingNotebook = false }, onDelete = {})
}

/** The two big coloured buttons, with a drawing in the corner. */
@Composable
private fun BigButton(label: String, color: Color, modifier: Modifier, art: @Composable () -> Unit, onClick: () -> Unit) {
    Box(modifier.height(150.dp).clip(RoundedCornerShape(16.dp)).background(color).clickable(onClick = onClick)) {
        Box(Modifier.align(Alignment.BottomEnd).size(110.dp, 90.dp)) { art() }
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Add, null, tint = Color(0xFF111411), modifier = Modifier.size(22.dp))
            Text(label, Modifier.padding(start = 6.dp), color = Color(0xFF111411), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A dark page with three lines, tilted, coming out of the corner. */
@Composable
private fun NoteArt() {
    Canvas(Modifier.fillMaxSize()) {
        rotate(15f, pivot = Offset(size.width * 0.7f, size.height)) {
            val left = size.width * 0.35f
            drawRoundRect(Color(0xFF262626), topLeft = Offset(left, size.height * 0.12f), size = Size(size.width, size.height), cornerRadius = CornerRadius(10f, 10f))
            for ((i, w) in listOf(0.38f, 0.5f, 0.38f).withIndex()) {
                drawLine(Color(0xFF6B6B6B), Offset(left + 20f, size.height * (0.32f + i * 0.13f)), Offset(left + 20f + size.width * w, size.height * (0.32f + i * 0.13f)), strokeWidth = 8f, cap = androidx.compose.ui.graphics.StrokeCap.Round)
            }
        }
    }
}

/** Two checklist cards, the first one ticked. */
@Composable
private fun TaskArt() {
    Canvas(Modifier.fillMaxSize()) {
        val dark = Color(0xFF4F2380)
        rotate(-12f, pivot = Offset(size.width, size.height)) {
            for ((i, y) in listOf(0.15f, 0.62f).withIndex()) {
                val top = size.height * y
                drawRoundRect(dark, topLeft = Offset(size.width * 0.12f, top), size = Size(size.width, size.height * 0.36f), cornerRadius = CornerRadius(12f, 12f))
                val cx = size.width * 0.27f
                val cy = top + size.height * 0.18f
                if (i == 0) {
                    drawCircle(Color(0xFFD8B8FF), radius = 15f, center = Offset(cx, cy))
                    val p = Path().apply { moveTo(cx - 7f, cy); lineTo(cx - 2f, cy + 5f); lineTo(cx + 7f, cy - 5f) }
                    drawPath(p, dark, style = Stroke(width = 4f))
                } else {
                    drawCircle(Color(0xFFD8B8FF), radius = 15f, center = Offset(cx, cy), style = Stroke(width = 3f))
                }
                drawLine(Color(0xFFC490FF), Offset(cx + 30f, cy), Offset(size.width, cy), strokeWidth = 9f, cap = androidx.compose.ui.graphics.StrokeCap.Round)
            }
        }
    }
}

@Composable
private fun Tile(icon: ImageVector, label: String, onClick: () -> Unit) {
    Column(
        Modifier.size(width = 112.dp, height = 104.dp).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceContainer).clickable(onClick = onClick).padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, null, Modifier.size(30.dp))
        Text(label, Modifier.padding(top = 10.dp), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * A scratch pad that is always there and keeps what is typed in it (on this device), until it is turned into a note or
 * cleared.
 */
@Composable
private fun ScratchPad() {
    val env = LocalApp.current
    val s = strings
    val c = MaterialTheme.colorScheme
    var text by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { text = env.repo.read { getMeta("ui.scratch") } ?: "" }
    LaunchedEffect(text) {
        val t = text ?: return@LaunchedEffect
        delay(500)
        env.repo.read { setMeta("ui.scratch", t.ifEmpty { null }) }
    }
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 24.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(s.scratchPad, Modifier.weight(1f), fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreHoriz, s.more) }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text(s.makeNote) }, enabled = !text.isNullOrBlank(), onClick = {
                    menu = false
                    val body = text.orEmpty().trim()
                    val html = body.split(Regex("\n{2,}")).filter { it.isNotBlank() }.joinToString("") { "<p>${Html.escape(it.trim()).replace("\n", "<br>")}</p>" }
                    text = ""
                    env.newNote(title = body.lineSequence().first().take(80), content = html)
                })
                DropdownMenuItem(text = { Text(s.clear) }, enabled = !text.isNullOrEmpty(), onClick = { menu = false; text = "" })
            }
        }
    }
    val pad = if (MaterialTheme.colorScheme.background.luminanceIsDark()) Color(0xFF26261F) else Color(0xFFFFF8D9)
    BasicTextField(
        value = text ?: "",
        onValueChange = { text = it },
        textStyle = TextStyle(fontSize = 16.sp, color = c.onSurface),
        cursorBrush = SolidColor(c.primary),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 160.dp).clip(RoundedCornerShape(14.dp)).background(pad).padding(18.dp),
        decorationBox = { inner -> Box { if (text.isNullOrEmpty()) Text(s.startWriting, fontSize = 16.sp, color = c.onSurfaceVariant); inner() } },
    )
}

private fun Color.luminanceIsDark() = (0.299f * red + 0.587f * green + 0.114f * blue) < 0.5f

@Composable
private fun Card(title: String, onAll: (() -> Unit)? = null, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).padding(top = 10.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 14.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            if (onAll != null) TextButton(onClick = onAll) { Text(strings.showAll, fontSize = 13.sp) }
        }
        content()
    }
}

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
