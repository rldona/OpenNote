package app.opennote.ui

import android.app.Activity
import android.content.Context
import android.os.Build
import java.lang.ref.WeakReference
import java.util.Locale

/** Set by the Application (context) and by MainActivity while it exists (the rest). */
object AndroidPlatform {
    lateinit var context: Context
    /** The activity on screen, to open the sign-in browser from. */
    var activity: WeakReference<Activity>? = null
    /** Asks for the notification permission (Android 13+); set by MainActivity. */
    var requestNotifications: (() -> Unit)? = null
    /** Asks for a runtime permission and answers whether it was granted; set by MainActivity. */
    var requestPermission: (suspend (String) -> Boolean)? = null
}

actual fun appDataDir(): String = AndroidPlatform.context.filesDir.absolutePath
actual fun deviceLanguage(): String = Locale.getDefault().language
actual fun deviceModelName(): String = Build.MODEL ?: "Android"
@androidx.compose.runtime.Composable
actual fun StatusBarIcons(dark: Boolean) {
    val view = androidx.compose.ui.platform.LocalView.current
    androidx.compose.runtime.SideEffect {
        val window = (activity?.get() ?: return@SideEffect).window
        androidx.core.view.WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !dark
    }
}

private val activity get() = AndroidPlatform.activity

actual object QuickPrefs {
    private val prefs get() = AndroidPlatform.context.getSharedPreferences("opennote.ui", Context.MODE_PRIVATE)
    actual fun get(key: String): String? = prefs.getString(key, null)
    actual fun set(key: String, value: String?) { prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply() }
}
