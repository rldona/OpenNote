package app.opennote.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.AutoFixNormal
import androidx.compose.material.icons.outlined.BorderColor
import androidx.compose.material.icons.outlined.Create
import androidx.compose.material.icons.outlined.DeleteSweep
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlin.math.hypot

private enum class Tool { PEN, MARKER, ERASER }

private class Line(val points: List<Offset>, val color: Color, val width: Float, val marker: Boolean)

private val INKS = listOf(Color(0xFF111111), Color(0xFFD93025), Color(0xFF1A73E8), Color(0xFF188038), Color(0xFFF9AB00))
private val WIDTHS = listOf(2f, 5f, 12f)
private val MARKER = Color(0xFFFFE066)

/**
 * A drawing pad on paper, full screen: pen, highlighter and eraser, five inks, three widths, undo and redo. "Done" gives a
 * PNG (white background, like the web app's sketches), which becomes an image in the note.
 */
@Composable
fun SketchDialog(onDone: (SharedFile) -> Unit, onClose: () -> Unit) {
    val s = strings
    val c = MaterialTheme.colorScheme
    val lines = remember { mutableStateListOf<Line>() }
    val undone = remember { mutableStateListOf<Line>() }
    var current by remember { mutableStateOf<List<Offset>?>(null) }
    var tool by remember { mutableStateOf(Tool.PEN) }
    var ink by remember { mutableStateOf(INKS[0]) }
    var width by remember { mutableStateOf(WIDTHS[1]) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    val scale = density.density

    /** The drawing, cut to what was drawn plus a margin, on white. */
    fun export() {
        if (lines.isEmpty() || size.width == 0) { onClose(); return }
        val margin = 24f * scale
        val pts = lines.flatMap { it.points }
        val reach = lines.maxOf { it.width } * scale
        val left = (pts.minOf { it.x } - reach - margin).coerceAtLeast(0f)
        val top = (pts.minOf { it.y } - reach - margin).coerceAtLeast(0f)
        val right = (pts.maxOf { it.x } + reach + margin).coerceAtMost(size.width.toFloat())
        val bottom = (pts.maxOf { it.y } + reach + margin).coerceAtMost(size.height.toFloat())
        val w = (right - left).toInt().coerceAtLeast(1)
        val h = (bottom - top).toInt().coerceAtLeast(1)
        val image = ImageBitmap(w, h)
        CanvasDrawScope().draw(density, direction, androidx.compose.ui.graphics.Canvas(image), Size(w.toFloat(), h.toFloat())) {
            drawRect(Color.White)
            translate(-left, -top) { drawLines(lines, scale) }
        }
        onDone(SharedFile("sketch.png", "image/png", encodePng(image)))
    }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        Column(Modifier.fillMaxSize().background(c.background).statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, s.cancel) }
                Text(s.sketch, Modifier.weight(1f), fontSize = 20.sp, fontWeight = FontWeight.SemiBold, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                TextButton(onClick = ::export) { Text(s.done2, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(enabled = lines.isNotEmpty(), onClick = { undone.add(lines.removeAt(lines.lastIndex)) }) { Icon(Icons.AutoMirrored.Filled.Undo, s.undo) }
                IconButton(enabled = undone.isNotEmpty(), onClick = { lines.add(undone.removeAt(undone.lastIndex)) }) { Icon(Icons.AutoMirrored.Filled.Redo, s.redo) }
                Spacer(Modifier.weight(1f))
                IconButton(enabled = lines.isNotEmpty(), onClick = { lines.clear(); undone.clear() }) { Icon(Icons.Outlined.DeleteSweep, s.clear) }
            }
            HorizontalDivider(color = c.outlineVariant)
            // The paper.
            Canvas(
                Modifier.weight(1f).fillMaxWidth().background(Color.White).onSizeChanged { size = it }
                    .pointerInput(Unit) {
                        awaitEachGesture {
                            val down = awaitFirstDown()
                            var pts = listOf(down.position)
                            if (tool == Tool.ERASER) eraseAt(lines, down.position, 18f * scale) else current = pts
                            while (true) {
                                val event = awaitPointerEvent()
                                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                if (!change.pressed) break
                                if (change.positionChange() != Offset.Zero) {
                                    change.consume()
                                    if (tool == Tool.ERASER) eraseAt(lines, change.position, 18f * scale)
                                    else { pts = pts + change.position; current = pts }
                                }
                            }
                            if (tool != Tool.ERASER) {
                                val marker = tool == Tool.MARKER
                                lines.add(Line(pts, if (marker) MARKER else ink, if (marker) 18f else width, marker))
                                undone.clear()
                                current = null
                            }
                        }
                    },
            ) {
                // Dots, like squared paper.
                val step = 24.dp.toPx()
                var y = step
                while (y < this.size.height) {
                    var x = step
                    while (x < this.size.width) { drawCircle(Color(0xFFDADCE0), 1.4f, Offset(x, y)); x += step }
                    y += step
                }
                drawLines(lines, scale)
                current?.let { pts ->
                    val marker = tool == Tool.MARKER
                    drawLines(listOf(Line(pts, if (marker) MARKER else ink, if (marker) 18f else width, marker)), scale)
                }
            }
            HorizontalDivider(color = c.outlineVariant)
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                ToolButton(Icons.Outlined.Create, s.pen, tool == Tool.PEN) { tool = Tool.PEN }
                ToolButton(Icons.Outlined.BorderColor, s.highlight, tool == Tool.MARKER) { tool = Tool.MARKER }
                ToolButton(Icons.Outlined.AutoFixNormal, s.eraser, tool == Tool.ERASER) { tool = Tool.ERASER }
                Spacer(Modifier.width(4.dp))
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                    for (color in INKS) Box(
                        Modifier.size(24.dp).clip(CircleShape).background(color)
                            .then(if (ink == color && tool == Tool.PEN) Modifier.border(3.dp, c.primary, CircleShape) else Modifier)
                            .clickable { ink = color; tool = Tool.PEN },
                    )
                }
                for (w in WIDTHS) Box(
                    Modifier.size(30.dp).clip(CircleShape).background(if (width == w) c.surfaceContainerHigh else Color.Transparent).clickable { width = w; if (tool == Tool.ERASER) tool = Tool.PEN },
                    contentAlignment = Alignment.Center,
                ) { Box(Modifier.size((4 + w).dp.coerceAtMost(18.dp)).clip(CircleShape).background(c.onSurface)) }
            }
        }
    }
}

@Composable
private fun ToolButton(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    val c = MaterialTheme.colorScheme
    Box(
        Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).background(if (active) c.primaryContainer else Color.Transparent).clickable(onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, tint = if (active) c.primary else c.onSurface) }
}

private fun DrawScope.drawLines(lines: List<Line>, scale: Float) {
    for (l in lines) {
        val w = l.width * scale
        if (l.points.size == 1) {
            drawCircle(l.color.copy(alpha = if (l.marker) 0.5f else 1f), w / 2, l.points[0], blendMode = if (l.marker) BlendMode.Multiply else BlendMode.SrcOver)
            continue
        }
        val path = Path().apply {
            moveTo(l.points[0].x, l.points[0].y)
            // Smooth: through the midpoints, with each point as the control.
            for (i in 1 until l.points.size) {
                val a = l.points[i - 1]
                val b = l.points[i]
                quadraticTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2)
            }
            lineTo(l.points.last().x, l.points.last().y)
        }
        drawPath(
            path, l.color.copy(alpha = if (l.marker) 0.5f else 1f),
            style = Stroke(width = w, cap = StrokeCap.Round, join = StrokeJoin.Round),
            blendMode = if (l.marker) BlendMode.Multiply else BlendMode.SrcOver,
        )
    }
}

/** The eraser takes away whole lines it touches. */
private fun eraseAt(lines: MutableList<Line>, at: Offset, radius: Float) {
    lines.removeAll { l -> l.points.any { hypot(it.x - at.x, it.y - at.y) < radius + l.width } }
}
