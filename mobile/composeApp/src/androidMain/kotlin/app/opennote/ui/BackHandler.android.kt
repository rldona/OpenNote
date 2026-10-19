package app.opennote.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.backhandler.BackHandler

@OptIn(ExperimentalComposeUiApi::class)
@Suppress("DEPRECATION") // NavigationEventHandler replaces it; one back step per screen is all the app needs for now.
@Composable
actual fun BackHandlerCompat(onBack: () -> Unit) = BackHandler(enabled = true, onBack = onBack)
