package app.opennote.ui

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import kotlin.coroutines.cancellation.CancellationException

/**
 * Android's back, predictive (Android 14 and later): while the gesture runs its progress goes to [BackGesture] and the
 * screen shrinks and shows the previous one behind (App.kt); letting go goes back, swiping back in cancels. The back button
 * and older versions just go back.
 */
@Composable
actual fun BackHandlerCompat(onBack: () -> Unit) {
    val current by rememberUpdatedState(onBack)
    PredictiveBackHandler(enabled = true) { events ->
        try {
            events.collect { e -> BackGesture.progress.value = e.progress }
            // Cleared before going back, so the transition finishes the move instead of jumping to the end.
            BackGesture.progress.value = null
            current()
        } catch (e: CancellationException) {
            BackGesture.progress.value = null
            throw e
        }
    }
}
