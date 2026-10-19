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
}

actual fun appDataDir(): String = AndroidPlatform.context.filesDir.absolutePath
actual fun deviceLanguage(): String = Locale.getDefault().language
actual fun deviceModelName(): String = Build.MODEL ?: "Android"
actual val showsBrandHeader: Boolean = true
