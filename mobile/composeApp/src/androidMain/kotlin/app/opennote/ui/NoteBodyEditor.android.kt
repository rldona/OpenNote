package app.opennote.ui

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader

/** The page is served from the app's assets (editor/, copied from web/dist-embed) under a fixed https origin. */
private const val EDITOR_URL = "https://appassets.androidplatform.net/assets/editor/index.html"

/**
 * One WebView for the whole app, created on first use and kept: opening a note only sends it the note's HTML, so the page
 * and its script are never loaded twice.
 */
private object EditorWebView {
    private var view: WebView? = null
    val ready = mutableStateOf(false)
    var listener: ((EditorEvent) -> Unit)? = null
    private val main = Handler(Looper.getMainLooper())

    @SuppressLint("SetJavaScriptEnabled")
    fun get(context: Context): WebView = view ?: run {
        val app = context.applicationContext
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(app)).build()
        WebView(app).apply {
            settings.javaScriptEnabled = true
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val path = request.url.path ?: ""
                    if (path.startsWith("/api/attachments/")) {
                        // Images and audio inside a note: the same URLs as on the web, served from the app's store.
                        val (bytes, mime) = EditorFiles.attachment?.invoke(path.removePrefix("/api/attachments/")) ?: return WebResourceResponse("text/plain", null, 404, "Not found", null, null)
                        return WebResourceResponse(mime, null, bytes.inputStream())
                    }
                    return loader.shouldInterceptRequest(request.url)
                }
                // Links inside a note never navigate the editor away; the page reports them instead.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            }
            addJavascriptInterface(
                object {
                    @JavascriptInterface
                    fun postMessage(json: String) {
                        main.post {
                            val e = parseEditorMessage(json) ?: return@post
                            if (e is EditorEvent.Ready) ready.value = true
                            listener?.invoke(e)
                        }
                    }
                },
                "OpenNoteAndroid",
            )
            loadUrl(EDITOR_URL)
            view = this
        }
    }

    /** Called early (app start) so the first note opens without waiting for the page. */
    fun warmUp(context: Context) { get(context) }
}

fun warmUpEditor(context: Context) = EditorWebView.warmUp(context)

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
    val context = LocalContext.current
    val events by rememberUpdatedState(onEvent)
    val webView = EditorWebView.get(context)
    val ready by EditorWebView.ready
    DisposableEffect(webView) {
        EditorWebView.listener = { events(it) }
        controller.eval = { js -> webView.evaluateJavascript(js, null) }
        onDispose {
            controller.eval = null
            EditorWebView.listener = null
        }
    }
    // Load the note once the page is up, and again whenever the screen shows another note.
    DisposableEffect(ready, noteKey) {
        if (ready) webView.evaluateJavascript(loadScript(html, dark, editable), null)
        onDispose { }
    }
    AndroidView(
        factory = { (webView.parent as? ViewGroup)?.removeView(webView); webView },
        modifier = modifier,
    )
}
