package app.opennote.android

import android.app.Application
import app.opennote.ui.AndroidPlatform

/** Runs first in every process start, also for a reminder or a background sync without the UI. */
class OpenNoteApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AndroidPlatform.context = applicationContext
    }
}
