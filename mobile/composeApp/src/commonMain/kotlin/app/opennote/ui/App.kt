package app.opennote.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Phase 0 spike (docs: mobile proposal): a list of 1 000 notes to judge scrolling and navigation, and a note screen with a
 * native title, the embedded web editor for the body and a native formatting bar above the keyboard.
 */
data class SpikeNote(val id: String, val title: String, val snippet: String, val html: String)

private val sample = List(1000) { i ->
    val words = "Reunión de equipo con el cliente para revisar el presupuesto, el diseño y las tareas del proyecto"
    SpikeNote(
        id = "n$i",
        title = if (i % 7 == 0) "Viaje a Lisboa · día ${i / 7 + 1}" else "Nota de prueba ${i + 1}",
        snippet = "$words · ${i + 1}",
        html = "<h2>Agenda</h2><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\" data-due=\"2026-11-02\"><p>Enviar acta</p></li>" +
            "<li data-type=\"taskItem\" data-checked=\"true\"><p>Revisar presupuesto</p></li></ul><p>$words.</p>".repeat(1) +
            "<p>${List(4) { words }.joinToString(". ")}.</p>",
    )
}

private fun scheme(dark: Boolean): ColorScheme = if (dark) {
    darkColorScheme(primary = Color(0xFF6FD39A), background = Color(0xFF151918), surface = Color(0xFF151918), onSurface = Color(0xFFE6EBE8), surfaceVariant = Color(0xFF1D2220), onSurfaceVariant = Color(0xFF8F9B94), outlineVariant = Color(0xFF2A312E))
} else {
    lightColorScheme(primary = Color(0xFF1C8A4E), background = Color.White, surface = Color.White, onSurface = Color(0xFF1B211E), surfaceVariant = Color(0xFFF6F7F5), onSurfaceVariant = Color(0xFF667069), outlineVariant = Color(0xFFE4E7E2))
}

@Composable
fun App() {
    val dark = isSystemInDarkTheme()
    MaterialTheme(colorScheme = scheme(dark)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            val notes = remember { mutableStateListOf(*sample.toTypedArray()) }
            var open by remember { mutableStateOf<SpikeNote?>(null) }
            // Kept outside the animated content, so coming back from a note returns to the same place in the list.
            val listState = rememberLazyListState()
            AnimatedContent(
                targetState = open,
                transitionSpec = {
                    if (targetState != null) slideInHorizontally { it } togetherWith slideOutHorizontally { -it / 3 }
                    else slideInHorizontally { -it / 3 } togetherWith slideOutHorizontally { it }
                },
            ) { note ->
                if (note == null) {
                    NoteList(notes, listState) { open = it }
                } else {
                    BackHandlerCompat { open = null }
                    NoteScreen(note, dark, onBack = { open = null }) { html ->
                        val i = notes.indexOfFirst { it.id == note.id }
                        if (i >= 0) notes[i] = notes[i].copy(html = html)
                    }
                }
            }
        }
    }
}

@Composable
private fun NoteList(notes: List<SpikeNote>, listState: LazyListState, onOpen: (SpikeNote) -> Unit) {
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 8.dp)) {
            Text("Todas las notas", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            Text("${notes.size} notas", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
            items(notes, key = { it.id }) { n ->
                Column(
                    Modifier.fillMaxWidth().clickable { onOpen(n) }.padding(horizontal = 20.dp, vertical = 12.dp),
                ) {
                    Text(n.title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(n.snippet, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                HorizontalDivider(Modifier.padding(start = 20.dp), color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@Composable
private fun NoteScreen(note: SpikeNote, dark: Boolean, onBack: () -> Unit, onChange: (String) -> Unit) {
    val controller = remember { EditorController() }
    var state by remember { mutableStateOf(EditorState()) }
    var title by remember(note.id) { mutableStateOf(note.title) }
    Column(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("‹", fontSize = 30.sp, color = MaterialTheme.colorScheme.primary, modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable { controller.flush(); onBack() }.padding(horizontal = 12.dp))
            Text("Trabajo", fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        BasicTextField(
            value = title,
            onValueChange = { title = it },
            textStyle = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        )
        NoteBodyEditor(
            noteKey = note.id,
            html = note.html,
            dark = dark,
            controller = controller,
            onEvent = { e ->
                when (e) {
                    is EditorEvent.State -> state = e.state
                    is EditorEvent.Change -> onChange(e.html)
                    else -> Unit
                }
            },
            modifier = Modifier.weight(1f).fillMaxWidth(),
        )
        FormatBar(state, controller)
    }
}

/** The native formatting bar, one row that scrolls sideways, kept right above the keyboard. */
@Composable
private fun FormatBar(state: EditorState, controller: EditorController) {
    val items = listOf(
        Triple("Aa", state.heading1 || state.heading2, "heading2"),
        Triple("B", state.bold, "bold"),
        Triple("I", state.italic, "italic"),
        Triple("U", state.underline, "underline"),
        Triple("•", state.bulletList, "bulletList"),
        Triple("1.", state.orderedList, "orderedList"),
        Triple("☑", state.taskList, "taskList"),
        Triple("❝", state.blockquote, "blockquote"),
        Triple("▦", false, "table"),
        Triple("↶", false, "undo"),
        Triple("↷", false, "redo"),
    )
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).navigationBarsPadding()) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            for ((label, active, command) in items) {
                Box(
                    Modifier.size(width = 46.dp, height = 44.dp).clip(RoundedCornerShape(10.dp))
                        .background(if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.16f) else Color.Transparent)
                        .clickable { controller.exec(command) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(label, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                }
            }
            Spacer(Modifier.width(8.dp))
        }
    }
}

/** System back: the back gesture or button on Android, the swipe from the left edge on iOS. */
@OptIn(ExperimentalComposeUiApi::class)
@Suppress("DEPRECATION") // NavigationEventHandler replaces it; this is enough for the spike's single back step.
@Composable
private fun BackHandlerCompat(onBack: () -> Unit) = BackHandler(enabled = true, onBack = onBack)
