package app.opennote.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.core.NoteInput
import app.opennote.ui.screens.HomeScreen
import app.opennote.ui.screens.LibraryScreen
import app.opennote.ui.screens.NoteScreen
import app.opennote.ui.screens.NotebooksScreen
import app.opennote.ui.screens.NotesScreen
import app.opennote.ui.screens.SearchScreen
import app.opennote.ui.screens.SettingsSectionScreen
import app.opennote.ui.screens.SettingsScreen
import app.opennote.ui.screens.TagsScreen
import app.opennote.ui.screens.TasksScreen
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlin.random.Random

/** Everything screens share: the data, the back stack, messages, the layout class and the person's choices. */
class AppEnv(
    val repo: Repo,
    val nav: Navigator,
    val snackbar: SnackbarHostState,
    val scope: CoroutineScope,
    val wide: Boolean,
    val theme: ThemeMode,
    val accent: Accent,
    val setAppearance: (ThemeMode, Accent) -> Unit,
    /** The sections of the bottom bar, in order. */
    val sections: List<Section>,
    val setSections: (List<Section>) -> Unit,
    /** Where new notes go when the screen does not say (Settings › Notebooks); null: the first notebook. */
    val defaultNotebook: String?,
    val setDefaultNotebook: (String?) -> Unit,
) {
    fun message(text: String) { scope.launch { snackbar.showSnackbar(text) } }

    private fun notebookFor(notebookId: String?) = notebookId ?: defaultNotebook

    /** Creates a note (in [notebookId], or with [tag], when the list on screen shows one) and opens it. */
    fun newNote(notebookId: String? = null, tag: String? = null, title: String = "", content: String? = null, action: NoteAction? = null) {
        scope.launch {
            val n = repo.write {
                val nb = notebookFor(notebookId)?.takeIf { id -> listNotebooks().any { it.id == id } }
                createNote(NoteInput(notebookId = nb, title = title, content = content, tags = tag?.let { listOf(it) }))
            }
            nav.push(Screen.Note(n.id, action, Random.nextLong()))
        }
    }

    /** A note that starts with one empty checklist item, the cursor in it. */
    fun newTask(notebookId: String? = null) = newNote(notebookId, content = EMPTY_TASK, action = NoteAction.TASK)

    /** A new note holding [files] (a photo, a scan, a recording, a sketch…), opened at once. */
    fun newNoteWith(files: List<SharedFile>, title: String = "", notebookId: String? = null) {
        if (files.isEmpty()) return
        scope.launch {
            val id = repo.write {
                val nb = notebookFor(notebookId)?.takeIf { id -> listNotebooks().any { it.id == id } }
                val note = createNote(NoteInput(notebookId = nb, title = title))
                val html = files.joinToString("") { attachmentHtml(addAttachment(note.id, it.name, it.mime, it.data)) }
                updateNote(note.id, NoteInput(content = html))
                note.id
            }
            nav.push(Screen.Note(id))
        }
    }

    companion object {
        const val EMPTY_TASK = "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p></p></li></ul>"
    }
}

val LocalApp = staticCompositionLocalOf<AppEnv> { error("no AppEnv") }

/** Native views (the editor's WebView) are hidden while a screen transition runs: they do not take part in it. */
val LocalSettled = staticCompositionLocalOf { true }

@Composable
fun App() {
    var repo by remember { mutableStateOf<Repo?>(null) }
    LaunchedEffect(Unit) {
        val opened = AppCore.repo()
        EditorFiles.attachment = { id -> runCatching { opened.blocking { getAttachmentData(id) to getAttachment(id).mime } }.getOrNull() }
        repo = opened
    }
    val r = repo
    if (r == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    var theme by remember { mutableStateOf(ThemeMode.SYSTEM) }
    var accent by remember { mutableStateOf(Accent.GREEN) }
    var sections by remember { mutableStateOf(Section.DEFAULT) }
    var defaultNotebook by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(r) {
        r.read { getMeta("ui.theme") }?.let { v -> ThemeMode.entries.firstOrNull { it.name == v }?.let { theme = it } }
        r.read { getMeta("ui.accent") }?.let { v -> Accent.entries.firstOrNull { it.name == v }?.let { accent = it } }
        sections = Section.parse(r.read { getMeta("ui.nav") })
        defaultNotebook = r.read { getMeta("ui.defaultNotebook") }
    }
    val scope = rememberCoroutineScope()
    val nav = remember { Navigator() }
    val snackbar = remember { SnackbarHostState() }
    OpenNoteTheme(theme, accent) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val wide = maxWidth >= 600.dp
                val env = remember(r, wide, theme, accent, sections, defaultNotebook) {
                    AppEnv(
                        r, nav, snackbar, scope, wide, theme, accent,
                        setAppearance = { t, a ->
                            theme = t; accent = a
                            scope.launch { r.write { setMeta("ui.theme", t.name); setMeta("ui.accent", a.name) } }
                        },
                        sections = sections,
                        setSections = { list -> sections = list; scope.launch { r.write { setMeta("ui.nav", list.joinToString(",") { it.name }) } } },
                        defaultNotebook = defaultNotebook,
                        setDefaultNotebook = { id -> defaultNotebook = id; scope.launch { r.write { setMeta("ui.defaultNotebook", id) } } },
                    )
                }
                CompositionLocalProvider(LocalApp provides env) {
                    // A tapped reminder or something shared to the app.
                    val pending by AppCore.openNote.collectAsState()
                    LaunchedEffect(pending) {
                        pending?.let { id -> nav.push(Screen.Note(id)); AppCore.openNote.value = null }
                    }
                    if (nav.canGoBack) BackHandlerCompat {
                        // After an interactive swipe the screen has already moved: no second slide.
                        if (BackGesture.progress.value != null) nav.skipAnimation.value = true
                        nav.back()
                    }
                    if (wide) WideLayout() else CompactLayout(maxWidth.value)
                    // The app is drawn edge to edge: lists scrolling up would show through the status bar without this.
                    Box(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(MaterialTheme.colorScheme.background))
                    StatusBarIcons(dark = isDarkTheme(theme))
                }
            }
        }
    }
}

@Composable
fun ScreenContent(screen: Screen, modifier: Modifier = Modifier) {
    Box(modifier) {
        when (screen) {
            Screen.Home -> HomeScreen()
            is Screen.Notes -> NotesScreen(screen.kind)
            is Screen.Note -> NoteScreen(screen)
            Screen.Search -> SearchScreen()
            Screen.Library -> LibraryScreen()
            Screen.Notebooks -> NotebooksScreen()
            Screen.Tags -> TagsScreen()
            Screen.Tasks -> TasksScreen()
            Screen.Settings -> SettingsScreen()
            is Screen.SettingsSection -> SettingsSectionScreen(screen.page)
        }
    }
}

/** Phones: one screen at a time, a bottom bar, and (iOS) the previous screen under the finger while swiping back. */
@Composable
private fun CompactLayout(widthDp: Float) = CompactContent(widthDp, Modifier.fillMaxSize())

/** The app icon (mobile/scripts/make-icons.mjs) in small: a white tile with the three green bars. */
@Composable
fun AppLogo(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val k = size.minDimension / 1024f
        drawRoundRect(Color.White, cornerRadius = CornerRadius(224 * k))
        for ((cx, cy, hw, hh) in listOf(listOf(512, 328, 205, 41), listOf(512, 512, 205, 41), listOf(410, 696, 103, 41))) {
            drawRoundRect(
                BrandGreen, topLeft = Offset((cx - hw) * k, (cy - hh) * k), size = Size(2 * hw * k, 2 * hh * k),
                cornerRadius = CornerRadius(24 * k),
            )
        }
    }
}

@Composable
private fun CompactContent(widthDp: Float, modifier: Modifier) {
    val env = LocalApp.current
    val nav = env.nav
    val top = nav.top
    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(env.snackbar) },
        // Screens handle the system bars themselves (the note's format bar sits above the home indicator).
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val progress = BackGesture.progress.value
            val dragging = progress != null && nav.canGoBack
            // Interactive back: the previous screen underneath, the current one following the finger. The current screen
            // keeps its place in the tree, so the editor's WebView under the finger is not re-created (that cancels the touch).
            if (dragging) PhoneScreen(nav.stack[nav.stack.lastIndex - 1])
            AnimatedContent(
                targetState = top,
                modifier = Modifier.fillMaxSize()
                    .offset { IntOffset(((progress ?: 0f) * widthDp * density).toInt(), 0) }
                    .then(if (dragging) Modifier.shadow(12.dp) else Modifier),
                transitionSpec = {
                    when {
                        nav.skipAnimation.value -> EnterTransition.None togetherWith ExitTransition.None
                        nav.wentBack.value -> slideInHorizontally { -it / 3 } togetherWith slideOutHorizontally { it }
                        else -> slideInHorizontally { it } togetherWith slideOutHorizontally { -it / 3 }
                    }
                },
            ) { screen ->
                val running = transition.isRunning
                LaunchedEffect(running) { if (!running) nav.skipAnimation.value = false }
                CompositionLocalProvider(LocalSettled provides !running) { PhoneScreen(screen) }
            }
        }
    }
}

/**
 * A phone screen with the bottom bar under it, except for a note and the settings. The bar belongs to the screen rather than
 * the Scaffold, so it slides away with the list when a note opens: if it disappeared at once, the area would grow
 * mid-transition and the incoming note would move vertically too.
 */
@Composable
private fun PhoneScreen(screen: Screen) {
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenContent(screen, Modifier.weight(1f).fillMaxWidth())
        if (screen !is Screen.Note && screen != Screen.Settings && screen !is Screen.SettingsSection) BottomBar()
    }
}

fun Section.icon(): ImageVector = when (this) {
    Section.HOME -> Icons.Outlined.AddCircleOutline
    Section.NOTES -> Icons.Outlined.Description
    Section.NOTEBOOKS -> Icons.Outlined.Book
    Section.SEARCH -> Icons.Filled.Search
    Section.PINNED -> Icons.Outlined.StarOutline
    Section.TASKS -> Icons.Outlined.CheckCircle
    Section.REMINDERS -> Icons.Outlined.NotificationsNone
    Section.TAGS -> Icons.AutoMirrored.Outlined.Label
    Section.TEMPLATES -> Icons.AutoMirrored.Outlined.Article
}

fun Section.label(): String = when (this) {
    Section.HOME -> strings.create
    Section.NOTES -> strings.notes
    Section.NOTEBOOKS -> strings.notebooks
    Section.SEARCH -> strings.search
    Section.PINNED -> strings.shortcuts
    Section.TASKS -> strings.tasks
    Section.REMINDERS -> strings.reminders
    Section.TAGS -> strings.tags
    Section.TEMPLATES -> strings.templates
}

/**
 * A floating pill with the person's sections and More, and a round search button next to it (the 2024 Evernote layout).
 */
@Composable
private fun BottomBar() {
    val env = LocalApp.current
    val nav = env.nav
    val current = Section.of(nav.stack.first())
    val s = strings
    val c = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).height(64.dp).shadow(6.dp, RoundedCornerShape(32.dp)).clip(RoundedCornerShape(32.dp))
                .background(c.surfaceContainer).border(1.dp, c.outlineVariant, RoundedCornerShape(32.dp)).padding(5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            for (sec in env.sections) {
                BarItem(sec.icon(), sec.label(), selected = sec == current, Modifier.weight(1f)) { nav.root(sec.screen) }
            }
            var more by remember { mutableStateOf(false) }
            val inMore = current != null && current !in env.sections
            Box(Modifier.weight(1f)) {
                BarItem(Icons.Filled.MoreHoriz, s.more, selected = inMore || more, Modifier.fillMaxWidth()) { more = true }
                MoreMenu(more) { more = false }
            }
        }
        Spacer(Modifier.width(10.dp))
        Box(
            Modifier.size(64.dp).shadow(6.dp, CircleShape).clip(CircleShape).background(c.onSurface).clickable { nav.push(Screen.Search) },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Search, s.search, tint = c.surface, modifier = Modifier.size(28.dp)) }
    }
}

@Composable
private fun BarItem(icon: ImageVector, label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = MaterialTheme.colorScheme
    Column(
        modifier.fillMaxHeight().clip(RoundedCornerShape(27.dp)).background(if (selected) c.surfaceContainerHigh else Color.Transparent).clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, null, Modifier.size(24.dp), tint = if (selected) c.primary else c.onSurface)
        Text(label, fontSize = 12.sp, maxLines = 1, color = if (selected) c.primary else c.onSurface, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
    }
}

/** The sections that are not in the bar, and a way to choose which are. */
@Composable
private fun MoreMenu(open: Boolean, onClose: () -> Unit) {
    val env = LocalApp.current
    val s = strings
    DropdownMenu(open, onClose, shape = RoundedCornerShape(18.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(s.more, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            IconButton(onClick = { onClose(); env.nav.push(Screen.SettingsSection(SettingsPage.NAVIGATION)) }) {
                Icon(Icons.Outlined.Settings, s.customizeNav, tint = MaterialTheme.colorScheme.primary)
            }
        }
        // Search has its own round button next to the bar.
        for (sec in Section.entries.filter { it !in env.sections && it != Section.SEARCH }) {
            DropdownMenuItem(
                text = { Text(sec.label(), fontSize = 16.sp) },
                leadingIcon = { Icon(sec.icon(), null) },
                onClick = { onClose(); env.nav.root(sec.screen) },
            )
        }
    }
}

/**
 * Tablets and large windows: a rail on the left; a note opens next to the list or search it came from (list–detail), and
 * the other screens use the whole width.
 */
@Composable
private fun WideLayout() {
    val env = LocalApp.current
    val nav = env.nav
    val tab = nav.tab()
    val s = strings
    // The rail and each screen keep clear of the system bars themselves (as on phones): no second padding here.
    Scaffold(snackbarHost = { SnackbarHost(env.snackbar) }, contentWindowInsets = WindowInsets(0)) { pad ->
        Row(Modifier.fillMaxSize().padding(pad)) {
            NavigationRail(header = {
                // Without the iPad's status bar the rail starts at the very top of the screen.
                FloatingActionButton(onClick = { env.newNote() }, Modifier.padding(top = 16.dp), containerColor = BrandGreen, contentColor = Color.White) { Icon(Icons.Filled.Add, s.newNote) }
            }) {
                Spacer(Modifier.height(8.dp))
                NavigationRailItem(tab == Tab.HOME, { nav.root(Screen.Home) }, { Icon(Section.HOME.icon(), null) }, label = { Text(s.create) })
                NavigationRailItem(tab == Tab.NOTES, { nav.root(Screen.Notes(NoteListKind.All)) }, { Icon(Section.NOTES.icon(), null) }, label = { Text(s.notes) })
                NavigationRailItem(tab == Tab.NOTEBOOKS, { nav.root(Screen.Notebooks) }, { Icon(Section.NOTEBOOKS.icon(), null) }, label = { Text(s.notebooks) })
                NavigationRailItem(tab == Tab.SEARCH, { nav.root(Screen.Search) }, { Icon(Icons.Filled.Search, null) }, label = { Text(s.search) })
                NavigationRailItem(tab == Tab.TASKS, { nav.root(Screen.Tasks) }, { Icon(Section.TASKS.icon(), null) }, label = { Text(s.tasks) })
                NavigationRailItem(nav.stack.first() == Screen.Library, { nav.root(Screen.Library) }, { Icon(Icons.Filled.MoreHoriz, null) }, label = { Text(s.more) })
                Spacer(Modifier.weight(1f))
                NavigationRailItem(nav.stack.first() == Screen.Settings, { nav.root(Screen.Settings) }, { Icon(Icons.Filled.Settings, null) }, label = { Text(s.settings) })
            }
            VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val top = nav.top
            val master = if (top is Screen.Note) nav.stack.getOrNull(nav.stack.lastIndex - 1) else top.takeIf { it is Screen.Notes || it == Screen.Search }
            if (master != null && (master is Screen.Notes || master == Screen.Search)) {
                ScreenContent(master, Modifier.width(360.dp).fillMaxHeight())
                VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (top is Screen.Note) {
                        ScreenContent(top, Modifier.fillMaxSize())
                    } else {
                        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(s.selectNote, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            } else {
                ScreenContent(top, Modifier.weight(1f).fillMaxHeight())
            }
        }
    }
}
