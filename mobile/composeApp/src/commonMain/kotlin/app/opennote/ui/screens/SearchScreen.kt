package app.opennote.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.core.ListFilter
import app.opennote.core.NoteSummary
import app.opennote.ui.LocalApp
import app.opennote.ui.NoteListKind
import app.opennote.ui.Screen
import app.opennote.ui.SectionTitle
import app.opennote.ui.strings
import kotlinx.coroutines.delay

private val OPERATORS = listOf("tag:", "notebook:", "intitle:", "todo:true", "resource:*", "reminderTime:*", "created:week", "updated:day", "-tag:")

/** Search with live results, one-tap operators with tag and notebook completion, and saved searches when empty. */
@Composable
fun SearchScreen() {
    val env = LocalApp.current
    val s = strings
    var q by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<NoteSummary>?>(null) }
    var names by remember { mutableStateOf<Pair<List<String>, List<String>>>(emptyList<String>() to emptyList()) }
    val saved = app.opennote.ui.load { read { listSavedSearches() } } ?: emptyList()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        names = env.repo.read { listTags().filter { !it.virtual }.map { it.name } to listNotebooks().map { it.name } }
        runCatching { focus.requestFocus() }
    }
    LaunchedEffect(q) {
        if (q.isBlank()) { results = null; return@LaunchedEffect }
        delay(150)
        results = runCatching { env.repo.read { listNotes(ListFilter(q = q, limit = 100)) } }.getOrDefault(emptyList())
    }
    val last = q.split(' ').lastOrNull() ?: ""
    val completion = Regex("^(-?)(tag|notebook):\"?(.*)$", RegexOption.IGNORE_CASE).find(last)?.let { m ->
        val (neg, op, part) = m.destructured
        val pool = if (op.lowercase() == "tag") names.first else names.second
        pool.filter { it.contains(part, ignoreCase = true) }.take(8).map { "$neg${op.lowercase()}:${if (' ' in it) "\"$it\"" else it}" }
    } ?: emptyList()
    fun apply(token: String, replace: Boolean) {
        val words = q.trimEnd().split(' ').filter { it.isNotEmpty() }.toMutableList()
        if (replace && words.isNotEmpty()) words.removeAt(words.lastIndex)
        words += token
        q = words.joinToString(" ") + if (token.endsWith(":")) "" else " "
    }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        OutlinedTextField(
            q, { q = it }, Modifier.fillMaxWidth().padding(16.dp).focusRequester(focus),
            leadingIcon = { Icon(Icons.Filled.Search, null) }, placeholder = { Text(s.searchHint) }, singleLine = true, shape = RoundedCornerShape(14.dp),
        )
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (op in completion.ifEmpty { OPERATORS }) AssistChip(onClick = { apply(op, completion.isNotEmpty()) }, label = { Text(op, fontFamily = FontFamily.Monospace, fontSize = 13.sp) })
        }
        val r = results
        if (r == null) {
            if (saved.isNotEmpty()) SectionTitle(s.savedSearches)
            LazyColumn {
                items(saved) { sv ->
                    Column(Modifier.fillMaxWidth().clickable { env.nav.push(Screen.Notes(NoteListKind.Saved(sv.name, sv.query))) }.padding(horizontal = 20.dp, vertical = 12.dp)) {
                        Text(sv.name)
                        Text(sv.query, fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        } else {
            if (r.isEmpty()) Text(s.noResults, Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyColumn(Modifier.fillMaxSize()) { items(r, key = { it.id }) { n -> NoteRow(n, selected = (env.nav.top as? Screen.Note)?.id == n.id) } }
        }
    }
}
