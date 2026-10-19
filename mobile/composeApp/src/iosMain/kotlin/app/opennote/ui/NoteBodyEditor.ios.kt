package app.opennote.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitView
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.readValue
import platform.CoreGraphics.CGRectZero
import platform.Foundation.NSBundle
import platform.UIKit.UIColor
import platform.WebKit.WKScriptMessage
import platform.WebKit.WKScriptMessageHandlerProtocol
import platform.WebKit.WKUserContentController
import platform.WebKit.WKWebView
import platform.WebKit.WKWebViewConfiguration
import platform.darwin.NSObject

/** Messages from the page arrive through `window.webkit.messageHandlers.opennote`. */
private class EditorMessages : NSObject(), WKScriptMessageHandlerProtocol {
    override fun userContentController(userContentController: WKUserContentController, didReceiveScriptMessage: WKScriptMessage) {
        val e = parseEditorMessage(didReceiveScriptMessage.body as? String ?: return) ?: return
        if (e is EditorEvent.Ready) EditorWebView.ready.value = true
        EditorWebView.listener?.invoke(e)
    }
}

/** One WKWebView for the whole app, loaded once from the app bundle (editor/, copied from web/dist-embed). */
private object EditorWebView {
    val ready = mutableStateOf(false)
    var listener: ((EditorEvent) -> Unit)? = null
    private val messages = EditorMessages()

    @OptIn(ExperimentalForeignApi::class)
    val view: WKWebView by lazy {
        val config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(messages, "opennote")
        WKWebView(frame = CGRectZero.readValue(), configuration = config).apply {
            opaque = false
            backgroundColor = UIColor.clearColor
            scrollView.backgroundColor = UIColor.clearColor
            val page = NSBundle.mainBundle.URLForResource("index", "html", "editor")
                ?: error("editor/index.html is missing from the app bundle")
            loadFileURL(page, allowingReadAccessToURL = page.URLByDeletingLastPathComponent!!)
        }
    }
}

/** Called at start so the first note opens without waiting for the page. */
fun warmUpEditor() {
    EditorWebView.view
}

@OptIn(ExperimentalForeignApi::class)
@Composable
actual fun NoteBodyEditor(
    noteKey: String,
    html: String,
    dark: Boolean,
    controller: EditorController,
    onEvent: (EditorEvent) -> Unit,
    modifier: Modifier,
) {
    val events by rememberUpdatedState(onEvent)
    val webView = EditorWebView.view
    val ready by EditorWebView.ready
    DisposableEffect(webView) {
        EditorWebView.listener = { events(it) }
        controller.eval = { js -> webView.evaluateJavaScript(js, completionHandler = null) }
        onDispose {
            controller.eval = null
            EditorWebView.listener = null
        }
    }
    DisposableEffect(ready, noteKey) {
        if (ready) webView.evaluateJavaScript(loadScript(html, dark), completionHandler = null)
        onDispose { }
    }
    UIKitView(factory = { webView.removeFromSuperview(); webView }, modifier = modifier)
}
