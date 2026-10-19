package app.opennote.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import app.opennote.core.NoteInput
import app.opennote.ui.screens.HomeScreen
import app.opennote.ui.screens.LibraryScreen
import app.opennote.ui.screens.NoteScreen
import app.opennote.ui.screens.NotesScreen
import app.opennote.ui.screens.SearchScreen
import app.opennote.ui.screens.SettingsScreen
import app.opennote.ui.screens.TasksScreen
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Everything screens share: the data, the back stack, messages, the layout class and the appearance. */
class AppEnv(
    val repo: Repo,
    val nav: Navigator,
    val snackbar: SnackbarHostState,
    val scope: CoroutineScope,
    val wide: Boolean,
    val theme: ThemeMode,
    val accent: Accent,
    val setAppearance: (ThemeMode, Accent) -> Unit,
) {
    fun message(text: String) { scope.launch { snackbar.showSnackbar(text) } }

    /** Creates a note (in [notebookId], or with [tag], when the list on screen shows one) and opens it. */
    fun newNote(notebookId: String? = null, tag: String? = null, title: String = "") {
        scope.launch {
            val n = repo.write { createNote(NoteInput(notebookId = notebookId, title = title, tags = tag?.let { listOf(it) })) }
            nav.push(Screen.Note(n.id))
        }
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
    LaunchedEffect(r) {
        r.read { getMeta("ui.theme") }?.let { v -> ThemeMode.entries.firstOrNull { it.name == v }?.let { theme = it } }
        r.read { getMeta("ui.accent") }?.let { v -> Accent.entries.firstOrNull { it.name == v }?.let { accent = it } }
    }
    val scope = rememberCoroutineScope()
    val nav = remember { Navigator() }
    val snackbar = remember { SnackbarHostState() }
    OpenNoteTheme(theme, accent) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val wide = maxWidth >= 600.dp
                val env = remember(r, wide, theme, accent) {
                    AppEnv(r, nav, snackbar, scope, wide, theme, accent) { t, a ->
                        theme = t; accent = a
                        scope.launch { r.write { setMeta("ui.theme", t.name); setMeta("ui.accent", a.name) } }
                    }
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
                    if (wide || !showsBrandHeader) {
                        Box(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(MaterialTheme.colorScheme.background))
                    }
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
            is Screen.Note -> NoteScreen(screen.id)
            Screen.Search -> SearchScreen()
            Screen.Library -> LibraryScreen()
            Screen.Tasks -> TasksScreen()
            Screen.Settings -> SettingsScreen()
        }
    }
}

/** Phones: one screen at a time, a bottom bar, and (iOS) the previous screen under the finger while swiping back. */
@Composable
private fun CompactLayout(widthDp: Float) {
    Column(Modifier.fillMaxSize()) {
        if (showsBrandHeader) BrandHeader()
        // Under the header the status bar is already taken care of: screens add no room for it, only a little air.
        CompactContent(
            widthDp,
            Modifier.weight(1f).then(if (showsBrandHeader) Modifier.consumeWindowInsets(WindowInsets.statusBars).padding(top = 4.dp) else Modifier),
        )
    }
}

/** Green band under the status bar with the logo and the app's name (Android phones). */
@Composable
private fun BrandHeader() {
    Row(
        Modifier.fillMaxWidth().background(BrandGreen).statusBarsPadding().height(48.dp).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AppLogo(Modifier.size(26.dp))
        Spacer(Modifier.width(10.dp))
        Text("OpenNote", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
    }
}

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
 * A phone screen with the bottom bar under it, except for a note. The bar belongs to the screen rather than the Scaffold, so
 * it slides away with the list when a note opens: if it disappeared at once, the area would grow mid-transition and the
 * incoming note would move vertically too.
 */
@Composable
private fun PhoneScreen(screen: Screen) {
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        ScreenContent(screen, Modifier.weight(1f).fillMaxWidth())
        if (screen !is Screen.Note) BottomBar()
    }
}

@Composable
private fun BottomBar() {
    val env = LocalApp.current
    val nav = env.nav
    val tab = nav.tab()
    val s = strings
    // On the screen's background with a hairline, like the note's format bar: in the cards' colour it merged with them.
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    NavigationBar(containerColor = MaterialTheme.colorScheme.background) {
        NavigationBarItem(tab == Tab.HOME, { nav.root(Screen.Home) }, { Icon(Icons.Filled.Home, null) }, label = { Text(s.home) })
        NavigationBarItem(tab == Tab.NOTES, { nav.root(Screen.Notes(NoteListKind.All)) }, { Icon(Icons.Filled.List, null) }, label = { Text(s.notes) })
        NavigationBarItem(false, { env.newNote() }, {
            Box(
                Modifier.background(BrandGreen, RoundedCornerShape(14.dp)).width(52.dp).height(40.dp),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Add, s.newNote, tint = Color.White) }
        })
        NavigationBarItem(tab == Tab.SEARCH, { nav.root(Screen.Search) }, { Icon(Icons.Filled.Search, null) }, label = { Text(s.search) })
        NavigationBarItem(tab == Tab.LIBRARY, { nav.root(Screen.Library) }, { Icon(Icons.Filled.Menu, null) }, label = { Text(s.more) })
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
                NavigationRailItem(tab == Tab.HOME, { nav.root(Screen.Home) }, { Icon(Icons.Filled.Home, null) }, label = { Text(s.home) })
                NavigationRailItem(tab == Tab.NOTES, { nav.root(Screen.Notes(NoteListKind.All)) }, { Icon(Icons.Filled.List, null) }, label = { Text(s.notes) })
                NavigationRailItem(tab == Tab.SEARCH, { nav.root(Screen.Search) }, { Icon(Icons.Filled.Search, null) }, label = { Text(s.search) })
                NavigationRailItem(tab == Tab.TASKS, { nav.root(Screen.Tasks) }, { Icon(Icons.Filled.CheckCircle, null) }, label = { Text(s.tasks) })
                NavigationRailItem(nav.stack.first() == Screen.Library, { nav.root(Screen.Library) }, { Icon(Icons.Filled.Menu, null) }, label = { Text(s.more) })
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
