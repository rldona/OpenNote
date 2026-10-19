package app.opennote.ui

import androidx.compose.ui.window.ComposeUIViewController
import platform.UIKit.UIViewController

/** Entry point used by iosApp (Swift): the whole UI is Compose. */
fun MainViewController(): UIViewController {
    warmUpEditor()
    return ComposeUIViewController { App() }
}
