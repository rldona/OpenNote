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
import kotlinx.cinterop.ObjCSignatureOverride
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.NSData
import platform.Foundation.NSHTTPURLResponse
import platform.Foundation.NSURL
import platform.Foundation.NSURLRequest
import platform.Foundation.create
import platform.WebKit.WKURLSchemeHandlerProtocol
import platform.WebKit.WKURLSchemeTaskProtocol

/** Messages from the page arrive through `window.webkit.messageHandlers.opennote`. */
private class EditorMessages : NSObject(), WKScriptMessageHandlerProtocol {
    override fun userContentController(userContentController: WKUserContentController, didReceiveScriptMessage: WKScriptMessage) {
        val e = parseEditorMessage(didReceiveScriptMessage.body as? String ?: return) ?: return
        if (e is EditorEvent.Ready) EditorWebView.ready.value = true
        EditorWebView.listener?.invoke(e)
    }
}

/**
 * `opennote://app/…`: the editor page and its files from the app bundle (editor/, copied from web/dist-embed), and
 * `/api/attachments/<id>` from the store, so notes reference attachments with the same URLs as on the web.
 */
@OptIn(ExperimentalForeignApi::class)
private class AppScheme : NSObject(), WKURLSchemeHandlerProtocol {
    @ObjCSignatureOverride
    override fun webView(webView: WKWebView, startURLSchemeTask: WKURLSchemeTaskProtocol) {
        val url = startURLSchemeTask.request.URL ?: return
        val path = url.path ?: "/"
        val found: Pair<ByteArray, String>? = if (path.startsWith("/api/attachments/")) {
            EditorFiles.attachment?.invoke(path.removePrefix("/api/attachments/"))
        } else {
            val name = path.trimStart('/').ifEmpty { "index.html" }
            NSBundle.mainBundle.pathForResource(name.substringBeforeLast('.'), name.substringAfterLast('.'), "editor")
                ?.let { NSData.create(contentsOfFile = it) }?.let { it.toByteArray() to EditorFiles.mimeOf(name) }
        }
        val (bytes, mime) = found ?: (ByteArray(0) to "text/plain")
        val response = NSHTTPURLResponse(uRL = url, statusCode = if (found != null) 200 else 404, HTTPVersion = "HTTP/1.1", headerFields = mapOf<Any?, Any?>("Content-Type" to mime))
        startURLSchemeTask.didReceiveResponse(response)
        startURLSchemeTask.didReceiveData(bytes.toNSData())
        startURLSchemeTask.didFinish()
    }

    @ObjCSignatureOverride
    override fun webView(webView: WKWebView, stopURLSchemeTask: WKURLSchemeTaskProtocol) {}
}

@OptIn(ExperimentalForeignApi::class)
internal fun ByteArray.toNSData(): NSData = if (isEmpty()) NSData() else usePinned { NSData.create(bytes = it.addressOf(0), length = size.toULong()) }

@OptIn(ExperimentalForeignApi::class)
internal fun NSData.toByteArray(): ByteArray {
    val out = ByteArray(length.toInt())
    if (out.isNotEmpty()) out.usePinned { platform.posix.memcpy(it.addressOf(0), bytes, length) }
    return out
}

/** One WKWebView for the whole app, loaded once from the app bundle (editor/, copied from web/dist-embed). */
private object EditorWebView {
    val ready = mutableStateOf(false)
    var listener: ((EditorEvent) -> Unit)? = null
    private val messages = EditorMessages()
    private val scheme = AppScheme()

    @OptIn(ExperimentalForeignApi::class)
    val view: WKWebView by lazy {
        val config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(messages, "opennote")
        config.setURLSchemeHandler(scheme, forURLScheme = "opennote")
        WKWebView(frame = CGRectZero.readValue(), configuration = config).apply {
            opaque = false
            backgroundColor = UIColor.clearColor
            scrollView.backgroundColor = UIColor.clearColor
            // Served by AppScheme: the page from the bundle, attachments from the store, all under one origin.
            loadRequest(NSURLRequest(uRL = NSURL(string = "opennote://app/index.html")))
            IosHooks.configureEditorWebView?.invoke(this)
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
    visible: Boolean,
    editable: Boolean,
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
    // Compose puts native views behind its own layer, so what shows through the transparent page is the UIKit container:
    // give the web view the screen's background instead.
    val bg = androidx.compose.material3.MaterialTheme.colorScheme.background
    DisposableEffect(bg) {
        val color = UIColor(red = bg.red.toDouble(), green = bg.green.toDouble(), blue = bg.blue.toDouble(), alpha = 1.0)
        webView.backgroundColor = color
        webView.scrollView.backgroundColor = color
        onDispose { }
    }
    // The theme as soon as the page is up, before any note arrives (and when it changes).
    DisposableEffect(ready, dark) {
        if (ready) webView.evaluateJavaScript("OpenNoteEditor.setTheme({dark: $dark})", completionHandler = null)
        onDispose { }
    }
    DisposableEffect(ready, noteKey) {
        if (ready) webView.evaluateJavaScript(loadScript(html, dark, editable), completionHandler = null)
        onDispose { }
    }
    UIKitView(
        factory = { webView.removeFromSuperview(); webView },
        update = { it.hidden = !visible },
        modifier = modifier,
    )
}

/**
 * Native setup the Kotlin side leaves to the Swift host (iosApp/iosApp/iOSApp.swift), set before the first screen:
 * removing WKWebView's own keyboard bar needs the Objective-C runtime, which is much simpler from Swift.
 */
object IosHooks {
    var configureEditorWebView: ((WKWebView) -> Unit)? = null
}
