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

sealed interface Screen {
    data object Home : Screen
    data class Notes(val kind: NoteListKind) : Screen
    data class Note(val id: String) : Screen
    data object Search : Screen
    data object Library : Screen
    data object Tasks : Screen
    data object Settings : Screen
}

/** The top-level destinations of the bottom bar (phones) and the rail (tablets). */
enum class Tab { HOME, NOTES, SEARCH, TASKS, LIBRARY }

/**
 * A simple back stack. Phones show its top; tablets show a note next to the screen it was opened from.
 * Opening a note while one is open replaces it, so back always returns to the list.
 */
class Navigator {
    val stack = mutableStateListOf<Screen>(Screen.Home)
    /** True for the last change that went back, so the transition slides the right way. */
    val wentBack = mutableStateOf(false)
    /** Set when an interactive back gesture already moved the screen, so the change is not animated again. */
    val skipAnimation = mutableStateOf(false)

    val top: Screen get() = stack.last()
    val canGoBack: Boolean get() = stack.size > 1

    fun push(s: Screen) {
        wentBack.value = false
        if (s is Screen.Note && top is Screen.Note) stack[stack.lastIndex] = s else stack.add(s)
    }

    fun back(): Boolean {
        if (!canGoBack) return false
        wentBack.value = true
        stack.removeAt(stack.lastIndex)
        return true
    }

    fun root(s: Screen) {
        wentBack.value = false
        stack.clear()
        stack.add(s)
    }

    fun tab(): Tab = when (stack.first()) {
        Screen.Home -> Tab.HOME
        is Screen.Notes, is Screen.Note -> Tab.NOTES
        Screen.Search -> Tab.SEARCH
        Screen.Tasks -> Tab.TASKS
        Screen.Library, Screen.Settings -> Tab.LIBRARY
    }
}

/** Progress (0…1) of an interactive back gesture in progress (iOS edge swipe), or null. */
object BackGesture {
    val progress = mutableStateOf<Float?>(null)
}
