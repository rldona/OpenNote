package app.opennote.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.delay
import kotlin.time.TimeSource

private val Panel = Color(0xFF1B2140)
private val Bars = Color(0xFF7C8CFF)
private val Red = Color(0xFFE5483B)

/**
 * The recording bar: time, a live level meter, pause and stop. Recording starts as soon as it shows; stop gives the file,
 * the cross throws the recording away.
 */
@Composable
fun RecorderBar(onDone: (SharedFile) -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val s = strings
    val done by rememberUpdatedState(onDone)
    val close by rememberUpdatedState(onClose)
    val recorder = remember { AudioRecorder() }
    var started by remember { mutableStateOf(false) }
    var paused by remember { mutableStateOf(false) }
    var elapsed by remember { mutableStateOf(0L) }
    val levels = remember { mutableStateListOf<Float>() }
    var finished by remember { mutableStateOf(false) }
    // Recorded time: what was recorded before the last pause, plus the time since recording went on again.
    var before by remember { mutableStateOf(0L) }
    var mark by remember { mutableStateOf(TimeSource.Monotonic.markNow()) }

    LaunchedEffect(Unit) {
        if (!recorder.start()) { close(); return@LaunchedEffect }
        started = true
        mark = TimeSource.Monotonic.markNow()
        while (true) {
            delay(100)
            if (!paused) {
                elapsed = before + mark.elapsedNow().inWholeMilliseconds
                levels.add(recorder.level())
                if (levels.size > 40) levels.removeAt(0)
            }
        }
    }
    DisposableEffect(Unit) { onDispose { if (!finished) recorder.cancel() } }

    Row(
        modifier.fillMaxWidth().height(64.dp).clip(RoundedCornerShape(32.dp)).background(Panel).padding(start = 22.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val sec = elapsed / 1000
        Text("${(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace)
        Canvas(Modifier.weight(1f).height(36.dp).padding(horizontal = 14.dp)) {
            val n = 40
            val step = size.width / n
            for (i in 0 until n) {
                val v = levels.getOrNull(levels.size - n + i)
                val x = i * step + step / 2
                if (v == null) drawCircle(Bars.copy(alpha = 0.6f), 2.5f, Offset(x, size.height / 2))
                else {
                    val h = (4f + v * (size.height - 4f)).coerceAtMost(size.height)
                    drawRoundRect(Bars, Offset(x - step * 0.3f, (size.height - h) / 2), Size(step * 0.6f, h), CornerRadius(3f, 3f))
                }
            }
        }
        RoundButton(Color(0xFF111111), enabled = started, onClick = {
            if (paused) { recorder.resume(); mark = TimeSource.Monotonic.markNow() } else { recorder.pause(); before = elapsed }
            paused = !paused
        }) {
            Icon(if (paused) Icons.Filled.PlayArrow else Icons.Filled.Pause, if (paused) s.resume else s.pause, tint = Color.White)
        }
        Spacer(Modifier.width(8.dp))
        RoundButton(Red, enabled = started, onClick = {
            finished = true
            val file = recorder.stop()
            if (file != null) done(file) else close()
        }) { Icon(Icons.Filled.Stop, s.stop, tint = Color.White) }
        Spacer(Modifier.width(4.dp))
        Box(Modifier.size(40.dp).clip(CircleShape).clickable { close() }, contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Close, s.cancel, tint = Color.White.copy(alpha = 0.7f))
        }
    }
}

@Composable
private fun RoundButton(color: Color, enabled: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(Modifier.size(48.dp).clip(CircleShape).background(color).clickable(enabled = enabled, onClick = onClick), contentAlignment = Alignment.Center) { content() }
}

/** The recording bar on its own, for a new voice note. */
@Composable
fun RecorderDialog(onDone: (SharedFile) -> Unit, onClose: () -> Unit) {
    Dialog(onDismissRequest = {}) {
        RecorderBar(onDone, onClose, Modifier.padding(8.dp))
    }
}
