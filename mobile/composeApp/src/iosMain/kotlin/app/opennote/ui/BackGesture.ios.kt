package app.opennote.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.ObjCAction
import kotlinx.cinterop.useContents
import platform.UIKit.UIGestureRecognizer
import platform.UIKit.UIGestureRecognizerDelegateProtocol
import platform.UIKit.UIGestureRecognizerStateEnded
import platform.UIKit.UIRectEdgeLeft
import platform.UIKit.UIScreenEdgePanGestureRecognizer
import platform.UIKit.UIView
import platform.darwin.NSObject
import platform.objc.sel_registerName

/** Screens that can go back register here; the swipe from the left edge calls the newest one. */
internal object SystemBack {
    val handlers = ArrayList<() -> Unit>()
    fun dispatch() {
        handlers.lastOrNull()?.invoke()
    }
}

@Composable
actual fun BackHandlerCompat(onBack: () -> Unit) {
    val current by rememberUpdatedState(onBack)
    DisposableEffect(Unit) {
        val h: () -> Unit = { current() }
        SystemBack.handlers.add(h)
        onDispose { SystemBack.handlers.remove(h) }
    }
}

/**
 * The iOS back gesture: a pan from the left edge of the window. It is installed on the whole Compose view, so it works over
 * the editor's WebView too, and goes back once the finger has travelled far enough or flicked.
 */
private class EdgeBack : NSObject(), UIGestureRecognizerDelegateProtocol {
    @OptIn(ExperimentalForeignApi::class)
    @ObjCAction
    fun pan(g: UIScreenEdgePanGestureRecognizer) {
        if (g.state != UIGestureRecognizerStateEnded) return
        val dx = g.translationInView(g.view).useContents { x }
        val vx = g.velocityInView(g.view).useContents { x }
        if (dx > 80.0 || vx > 500.0) SystemBack.dispatch()
    }

    // Let the WebView keep its own gestures (selection, scrolling) alongside this one.
    override fun gestureRecognizer(gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWithGestureRecognizer: UIGestureRecognizer) = true
}

private val edgeBack = EdgeBack()

@OptIn(ExperimentalForeignApi::class)
internal fun installBackGesture(view: UIView) {
    val g = UIScreenEdgePanGestureRecognizer(target = edgeBack, action = sel_registerName("pan:"))
    g.edges = UIRectEdgeLeft
    g.delegate = edgeBack
    view.addGestureRecognizer(g)
}
