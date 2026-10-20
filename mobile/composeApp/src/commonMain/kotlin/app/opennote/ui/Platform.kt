package app.opennote.ui

/** Directory where the app keeps its database and attachments (private to the app). */
expect fun appDataDir(): String

/** Two-letter language of the device, for the interface texts. */
expect fun deviceLanguage(): String

/** A readable name for this device, used as the default sync device name. */
expect fun deviceModelName(): String

/** The system back action: Android's back button and gesture, the iOS edge swipe (BackGesture.ios.kt). */
@androidx.compose.runtime.Composable
expect fun BackHandlerCompat(onBack: () -> Unit)

/** Where secrets are kept: the Keychain on iOS, the Keystore on Android. */
expect fun platformSecrets(): app.opennote.sync.SecretStore

/** The Google OAuth client this build signs in with; null when the build was made without one. */
class SignInConfig(val clientId: String, val redirectUri: String) {
    val scheme: String get() = redirectUri.substringBefore(':')
}

expect fun signInConfig(): SignInConfig?

/**
 * Shows [url] in the system's sign-in browser (ASWebAuthenticationSession, Custom Tabs) and returns the URL it was sent
 * back to on [scheme], or null when the person closed it.
 */
expect suspend fun openSignInBrowser(url: String, scheme: String): String?

/** A local notification for a note's reminder. */
data class ReminderAlert(val noteId: String, val title: String, val at: Long)

/** Replaces every scheduled reminder notification with [alerts]. */
expect fun scheduleReminders(alerts: List<ReminderAlert>)

/** Asks the system to call [AppCore.backgroundSync] now and then while the app is not open. */
expect fun scheduleBackgroundSync()

/** Dark or light status bar icons, to match the app's theme rather than the system's (Android; iOS follows by itself). */
@androidx.compose.runtime.Composable
expect fun StatusBarIcons(dark: Boolean)
