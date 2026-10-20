package app.opennote.ui

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf

/** Which notes a list shows (the web app's views: web/src/route.ts). */
sealed interface NoteListKind {
    data object All : NoteListKind
    data object Pinned : NoteListKind
    data object Reminders : NoteListKind
    data object Trash : NoteListKind
    data object Templates : NoteListKind
    data class Notebook(val id: String, val name: String) : NoteListKind
    data class Tag(val name: String) : NoteListKind
    data class Saved(val name: String, val query: String) : NoteListKind
}

/** Settings pages under the settings list. */
enum class SettingsPage { APPEARANCE, NAVIGATION, NOTEBOOKS, SYNC, ABOUT }

/** Something to do as soon as a note opens (from the Create screen's shortcuts). */
enum class NoteAction { REMINDER, TASK }

sealed interface Screen {
    data object Home : Screen
    data class Notes(val kind: NoteListKind) : Screen
    /** [nonce] tells apart two openings of the same note with an action, so each action runs once. */
    data class Note(val id: String, val action: NoteAction? = null, val nonce: Long = 0) : Screen
    data object Search : Screen
    data object Library : Screen
    data object Notebooks : Screen
    data object Tags : Screen
    data object Tasks : Screen
    data object Settings : Screen
    data class SettingsSection(val page: SettingsPage) : Screen
}

/**
 * The places the bottom bar (phones) can lead to. The person picks which ones it shows (Settings › Navigation); Notes is
 * always there, the rest live in the More menu.
 */
enum class Section(val screen: Screen) {
    HOME(Screen.Home),
    NOTES(Screen.Notes(NoteListKind.All)),
    NOTEBOOKS(Screen.Notebooks),
    SEARCH(Screen.Search),
    PINNED(Screen.Notes(NoteListKind.Pinned)),
    TASKS(Screen.Tasks),
    REMINDERS(Screen.Notes(NoteListKind.Reminders)),
    TAGS(Screen.Tags),
    TEMPLATES(Screen.Notes(NoteListKind.Templates)),
    ;

    companion object {
        /** How many sections fit in the bar next to More. */
        const val IN_BAR = 3
        val DEFAULT = listOf(HOME, NOTES, NOTEBOOKS)

        fun parse(saved: String?): List<Section> {
            val picked = saved?.split(',')?.mapNotNull { n -> entries.firstOrNull { it.name == n } }?.distinct().orEmpty()
            if (picked.isEmpty()) return DEFAULT
            return (if (NOTES in picked) picked else listOf(NOTES) + picked).take(IN_BAR)
        }

        /** The section a screen belongs to, for the bar's selection. */
        fun of(screen: Screen): Section? = when (screen) {
            Screen.Home -> HOME
            is Screen.Notes -> when (screen.kind) {
                NoteListKind.Pinned -> PINNED
                NoteListKind.Reminders -> REMINDERS
                NoteListKind.Templates -> TEMPLATES
                is NoteListKind.Notebook -> NOTEBOOKS
                is NoteListKind.Tag -> TAGS
                else -> NOTES
            }
            is Screen.Note -> NOTES
            Screen.Search -> SEARCH
            Screen.Notebooks -> NOTEBOOKS
            Screen.Tags -> TAGS
            Screen.Tasks -> TASKS
            else -> null
        }
    }
}

/** The top-level destinations of the rail (tablets). */
enum class Tab { HOME, NOTES, NOTEBOOKS, SEARCH, TASKS, LIBRARY }

/**
 * A simple back stack. Phones show its top; tablets show a note next to the screen it was opened from.
 * Opening a note while one is open replaces it, so back always returns to the list.
 */
class Navigator {
    val stack = mutableStateListOf<Screen>(Screen.Home)
    /** True for the last change that went back, so the transition slides the right way. */
    val wentBack = mutableStateOf(false)
    /** True when the last change switched sections (the bar): a fade rather than a slide. */
    val wentToRoot = mutableStateOf(false)
    /** Set when an interactive back gesture already moved the screen, so the change is not animated again. */
    val skipAnimation = mutableStateOf(false)

    val top: Screen get() = stack.last()
    val canGoBack: Boolean get() = stack.size > 1

    fun push(s: Screen) {
        wentBack.value = false
        wentToRoot.value = false
        if (s is Screen.Note && top is Screen.Note) stack[stack.lastIndex] = s else stack.add(s)
    }

    fun back(): Boolean {
        if (!canGoBack) return false
        wentBack.value = true
        wentToRoot.value = false
        stack.removeAt(stack.lastIndex)
        return true
    }

    fun root(s: Screen) {
        wentBack.value = false
        wentToRoot.value = true
        stack.clear()
        stack.add(s)
    }

    private val doneActions = mutableSetOf<Long>()

    /** The action [s] was opened with, the first time it is asked for; null afterwards. */
    fun takeAction(s: Screen.Note): NoteAction? = s.action?.takeIf { doneActions.add(s.nonce) }

    fun tab(): Tab = when (stack.first()) {
        Screen.Home -> Tab.HOME
        is Screen.Notes, is Screen.Note -> Tab.NOTES
        Screen.Notebooks -> Tab.NOTEBOOKS
        Screen.Search -> Tab.SEARCH
        Screen.Tasks -> Tab.TASKS
        else -> Tab.LIBRARY
    }
}

/** Progress (0…1) of an interactive back gesture in progress (iOS edge swipe), or null. */
object BackGesture {
    val progress = mutableStateOf<Float?>(null)
}
