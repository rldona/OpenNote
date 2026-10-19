package app.opennote.ui

import android.content.Context
import android.os.Build
import java.util.Locale

/** Set by MainActivity before the UI starts. */
object AndroidPlatform {
    lateinit var context: Context
}

actual fun appDataDir(): String = AndroidPlatform.context.filesDir.absolutePath
actual fun deviceLanguage(): String = Locale.getDefault().language
actual fun deviceModelName(): String = Build.MODEL ?: "Android"
