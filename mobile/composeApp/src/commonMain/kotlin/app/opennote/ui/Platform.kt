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
