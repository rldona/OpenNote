package app.opennote.ui

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.browser.customtabs.CustomTabsIntent
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.opennote.sync.SecretStore
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

actual fun platformSecrets(): SecretStore = KeystoreSecretStore(AndroidPlatform.context)

/**
 * The Android OAuth client, with "custom URI scheme" enabled in its advanced settings: Google then redirects to the
 * package name as a scheme, which [SignInRedirectActivity] receives.
 */
actual fun signInConfig(): SignInConfig? = GOOGLE_ANDROID_CLIENT_ID.takeIf { it.isNotEmpty() }?.let {
    SignInConfig(it, "${AndroidPlatform.context.packageName}:/oauth2redirect")
}

/** The sign-in in progress, between the Custom Tab and [SignInRedirectActivity]. */
object AndroidSignIn {
    internal var pending: CompletableDeferred<String?>? = null
    private var leftApp = false

    internal fun deliver(url: String) { pending?.complete(url) }

    /** The activity is back in front: if the browser sent nothing, the person closed it. */
    fun onResume() {
        val p = pending ?: return
        if (!leftApp) return
        leftApp = false
        Handler(Looper.getMainLooper()).postDelayed({ p.complete(null) }, 800)
    }

    fun onPause() { if (pending != null) leftApp = true }
}

actual suspend fun openSignInBrowser(url: String, scheme: String): String? {
    val result = CompletableDeferred<String?>()
    AndroidSignIn.pending = result
    try {
        withContext(Dispatchers.Main) {
            val activity = AndroidPlatform.activity?.get() ?: return@withContext result.complete(null)
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(activity, Uri.parse(url))
        }
        return result.await()
    } finally {
        AndroidSignIn.pending = null
    }
}

/** Receives Google's redirect (app.opennote:/oauth2redirect?code=…) and brings the app back over the browser. */
class SignInRedirectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.data?.toString()?.let(AndroidSignIn::deliver)
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            startActivity(it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }
        finish()
    }
}

// ---------------------------------------------------------------- reminders

private const val CHANNEL = "reminders"
private const val EXTRA_TITLE = "title"
const val EXTRA_NOTE_ID = "app.opennote.noteId"

private fun reminderIntent(ctx: Context, noteId: String) = Intent(ctx, ReminderReceiver::class.java)
    .setAction("app.opennote.REMINDER").setData(Uri.parse("opennote://note/$noteId"))

actual fun scheduleReminders(alerts: List<ReminderAlert>) {
    val ctx = AndroidPlatform.context
    val alarms = ctx.getSystemService(AlarmManager::class.java)
    val prefs = ctx.getSharedPreferences("opennote.reminders", Context.MODE_PRIVATE)
    val ids = alerts.map { it.noteId }.toSet()
    for (old in prefs.getStringSet("ids", emptySet()).orEmpty() - ids) {
        PendingIntent.getBroadcast(ctx, 0, reminderIntent(ctx, old), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let(alarms::cancel)
    }
    for (a in alerts) {
        val pi = PendingIntent.getBroadcast(
            ctx, 0, reminderIntent(ctx, a.noteId).putExtra(EXTRA_TITLE, a.title),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // Exact when the person allowed it (Android 12+ asks), otherwise within a few minutes.
        if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, a.at, pi)
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, a.at, pi)
    }
    prefs.edit().putStringSet("ids", ids).apply()
    if (alerts.isNotEmpty()) AndroidPlatform.requestNotifications?.invoke()
}

/** Shows a reminder; tapping it opens the note. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val noteId = intent.data?.lastPathSegment ?: return
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, strings.reminders, NotificationManager.IMPORTANCE_HIGH))
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
            .putExtra(EXTRA_NOTE_ID, noteId).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .setData(Uri.parse("opennote://note/$noteId"))
        val icon = context.resources.getIdentifier("ic_notification", "drawable", context.packageName)
            .takeIf { it != 0 } ?: android.R.drawable.ic_popup_reminder
        val n = Notification.Builder(context, CHANNEL)
            .setSmallIcon(icon)
            .setContentTitle(intent.getStringExtra(EXTRA_TITLE) ?: strings.reminder)
            .setContentText(strings.reminder)
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .build()
        nm.notify(noteId.hashCode(), n)
    }
}

/** Alarms do not survive a restart or an update of the app: set them again. */
class RescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val done = goAsync()
        AppCore.scope.launch {
            try { AppCore.refreshReminders(AppCore.repo()) } finally { done.finish() }
        }
    }
}

// ---------------------------------------------------------------- background sync

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        AppCore.backgroundSync()
        // A failure (no network after all, a wrong passphrase) waits for the next period rather than retrying at once.
        return Result.success()
    }
}

actual fun scheduleBackgroundSync() {
    val request = PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .build()
    WorkManager.getInstance(AndroidPlatform.context).enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.KEEP, request)
}
