package app.opennote.ui

import app.opennote.sync.SecretStore
import kotlin.coroutines.resume
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import platform.AuthenticationServices.ASPresentationAnchor
import platform.AuthenticationServices.ASWebAuthenticationPresentationContextProvidingProtocol
import platform.AuthenticationServices.ASWebAuthenticationSession
import platform.BackgroundTasks.BGAppRefreshTask
import platform.BackgroundTasks.BGAppRefreshTaskRequest
import platform.BackgroundTasks.BGTaskScheduler
import platform.Foundation.NSDate
import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSOperationQueue
import platform.Foundation.NSURL
import platform.Foundation.dateWithTimeIntervalSinceNow
import platform.UIKit.UIApplication
import platform.UIKit.UIApplicationDidBecomeActiveNotification
import platform.UIKit.UIApplicationDidEnterBackgroundNotification
import platform.UIKit.UIBackgroundTaskInvalid
import platform.UserNotifications.UNAuthorizationOptionAlert
import platform.UserNotifications.UNAuthorizationOptionSound
import platform.UserNotifications.UNMutableNotificationContent
import platform.UserNotifications.UNNotification
import platform.UserNotifications.UNNotificationPresentationOptionBanner
import platform.UserNotifications.UNNotificationPresentationOptionList
import platform.UserNotifications.UNNotificationPresentationOptionSound
import platform.UserNotifications.UNNotificationPresentationOptions
import platform.UserNotifications.UNNotificationRequest
import platform.UserNotifications.UNNotificationResponse
import platform.UserNotifications.UNNotificationSound
import platform.UserNotifications.UNTimeIntervalNotificationTrigger
import platform.UserNotifications.UNUserNotificationCenter
import platform.UserNotifications.UNUserNotificationCenterDelegateProtocol
import platform.darwin.NSObject

private const val SYNC_TASK = "app.opennote.sync"

actual fun platformSecrets(): SecretStore = KeychainSecretStore()

/**
 * The iOS OAuth client. Google redirects it to the client ID reversed (com.googleusercontent.apps.<id>), which
 * ASWebAuthenticationSession catches without the scheme being registered in Info.plist.
 */
actual fun signInConfig(): SignInConfig? = GOOGLE_IOS_CLIENT_ID.takeIf { it.isNotEmpty() }?.let { id ->
    val scheme = id.removeSuffix(".apps.googleusercontent.com").let { "com.googleusercontent.apps.$it" }
    SignInConfig(id, "$scheme:/oauth2redirect")
}

private var authSession: ASWebAuthenticationSession? = null
// Delegates are weak references in UIKit: these keep them alive.
private val authAnchor = AuthAnchor()
private val notificationDelegate = NotificationDelegate()

private class AuthAnchor : NSObject(), ASWebAuthenticationPresentationContextProvidingProtocol {
    @Suppress("DEPRECATION")
    override fun presentationAnchorForWebAuthenticationSession(session: ASWebAuthenticationSession): ASPresentationAnchor =
        UIApplication.sharedApplication.keyWindow
}

actual suspend fun openSignInBrowser(url: String, scheme: String): String? = withContext(Dispatchers.Main) {
    suspendCancellableCoroutine { cont ->
        val session = ASWebAuthenticationSession(NSURL(string = url), scheme) { callback, _ ->
            authSession = null
            if (cont.isActive) cont.resume(callback?.absoluteString)
        }
        session.presentationContextProvider = authAnchor
        authSession = session
        cont.invokeOnCancellation { session.cancel() }
        if (!session.start()) {
            authSession = null
            cont.resume(null)
        }
    }
}

actual fun scheduleReminders(alerts: List<ReminderAlert>) {
    val center = UNUserNotificationCenter.currentNotificationCenter()
    // Every pending notification of the app is a reminder: replace them all.
    center.removeAllPendingNotificationRequests()
    if (alerts.isEmpty()) return
    // The system asks only the first time; afterwards this just answers.
    center.requestAuthorizationWithOptions(UNAuthorizationOptionAlert or UNAuthorizationOptionSound) { _, _ -> }
    val now = nowMs()
    for (a in alerts) {
        val content = UNMutableNotificationContent().apply {
            setTitle(a.title)
            setBody(strings.reminder)
            setSound(UNNotificationSound.defaultSound)
            setUserInfo(mapOf<Any?, Any?>("noteId" to a.noteId))
        }
        val seconds = ((a.at - now) / 1000.0).coerceAtLeast(1.0)
        val trigger = UNTimeIntervalNotificationTrigger.triggerWithTimeInterval(seconds, repeats = false)
        center.addNotificationRequest(UNNotificationRequest.requestWithIdentifier("reminder.${a.noteId}", content, trigger), null)
    }
}

/** Shows reminders while the app is open too, and opens the note when one is tapped. */
private class NotificationDelegate : NSObject(), UNUserNotificationCenterDelegateProtocol {
    override fun userNotificationCenter(
        center: UNUserNotificationCenter, willPresentNotification: UNNotification,
        withCompletionHandler: (UNNotificationPresentationOptions) -> Unit,
    ) = withCompletionHandler(UNNotificationPresentationOptionBanner or UNNotificationPresentationOptionList or UNNotificationPresentationOptionSound)

    override fun userNotificationCenter(
        center: UNUserNotificationCenter, didReceiveNotificationResponse: UNNotificationResponse, withCompletionHandler: () -> Unit,
    ) {
        (didReceiveNotificationResponse.notification.request.content.userInfo["noteId"] as? String)?.let { AppCore.openNote.value = it }
        withCompletionHandler()
    }
}

actual fun scheduleBackgroundSync() {
    val request = BGAppRefreshTaskRequest(SYNC_TASK).apply { earliestBeginDate = NSDate.dateWithTimeIntervalSinceNow(3600.0) }
    @OptIn(ExperimentalForeignApi::class)
    BGTaskScheduler.sharedScheduler.submitTaskRequest(request, null)
}

private fun runRefresh(task: BGAppRefreshTask) {
    scheduleBackgroundSync() // the next one
    val job = AppCore.scope.launch { task.setTaskCompletedWithSuccess(AppCore.backgroundSync()) }
    task.expirationHandler = { job.cancel(); task.setTaskCompletedWithSuccess(false) }
}

/**
 * Called by iosApp while the app launches (the background task must be registered before launch ends): notifications,
 * background refresh, and sync when the app comes to the front or leaves it.
 */
fun startIosServices() {
    UNUserNotificationCenter.currentNotificationCenter().delegate = notificationDelegate
    BGTaskScheduler.sharedScheduler.registerForTaskWithIdentifier(SYNC_TASK, usingQueue = null) { task ->
        (task as? BGAppRefreshTask)?.let(::runRefresh)
    }
    val center = NSNotificationCenter.defaultCenter
    center.addObserverForName(UIApplicationDidBecomeActiveNotification, null, NSOperationQueue.mainQueue) { _ -> AppCore.onForeground() }
    center.addObserverForName(UIApplicationDidEnterBackgroundNotification, null, NSOperationQueue.mainQueue) { _ ->
        if (AppCore.readyToSync) {
            scheduleBackgroundSync()
            // Send what was just typed: iOS gives the app a little time after it leaves the screen.
            val app = UIApplication.sharedApplication
            var id = UIBackgroundTaskInvalid
            id = app.beginBackgroundTaskWithExpirationHandler { app.endBackgroundTask(id) }
            AppCore.scope.launch {
                AppCore.syncIfReady()
                withContext(Dispatchers.Main) { app.endBackgroundTask(id) }
            }
        }
    }
}
