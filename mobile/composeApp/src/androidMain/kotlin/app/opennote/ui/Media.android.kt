package app.opennote.ui

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.max
import kotlin.math.sqrt

@Composable
actual fun rememberCapture(): Capture {
    val ctx = AndroidPlatform.context
    val callbacks = remember { arrayOfNulls<Any>(2) }
    val photo = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        @Suppress("UNCHECKED_CAST")
        val done = callbacks[0] as? (SharedFile?) -> Unit
        callbacks[0] = null
        val file = PhotoFiles.pending
        PhotoFiles.pending = null
        done?.invoke(if (ok && file != null && file.length() > 0) runCatching { photoFromFile(file) }.getOrNull() else null)
        file?.delete()
    }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        @Suppress("UNCHECKED_CAST")
        val done = callbacks[1] as? (List<SharedFile>) -> Unit
        callbacks[1] = null
        done?.invoke(uris.mapNotNull { readUri(it) })
    }
    return remember {
        object : Capture {
            override val canScan = false
            override fun photo(onResult: (SharedFile?) -> Unit) {
                val dir = File(ctx.cacheDir, "camera").apply { mkdirs() }
                val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
                PhotoFiles.pending = file
                callbacks[0] = onResult
                photo.launch(FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file))
            }
            override fun scan(onResult: (List<SharedFile>) -> Unit) = onResult(emptyList())
            override fun files(onResult: (List<SharedFile>) -> Unit) {
                callbacks[1] = onResult
                files.launch(arrayOf("*/*"))
            }
        }
    }
}

/** The photo being taken (the camera app writes it to this file); kept outside the composition, which may be rebuilt meanwhile. */
private object PhotoFiles {
    var pending: File? = null
}

/** Camera photos are large: at most 2560 px on the longer side, JPEG at 85 %, turned upright. */
private fun photoFromFile(file: File): SharedFile {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2560) sample *= 2
    var bmp = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
    val rotation = runCatching {
        when (android.media.ExifInterface(file.path).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1)) {
            6 -> 90f; 3 -> 180f; 8 -> 270f; else -> 0f
        }
    }.getOrDefault(0f)
    val longer = max(bmp.width, bmp.height)
    if (longer > 2560 || rotation != 0f) {
        val k = minOf(1f, 2560f / longer)
        val m = android.graphics.Matrix().apply { postScale(k, k); postRotate(rotation) }
        bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    }
    val out = ByteArrayOutputStream()
    bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
    return SharedFile("photo-${System.currentTimeMillis() / 1000}.jpg", "image/jpeg", out.toByteArray())
}

private fun readUri(uri: Uri): SharedFile? = runCatching {
    val cr = AndroidPlatform.context.contentResolver
    val name = cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        ?: uri.lastPathSegment ?: "file"
    val mime = cr.getType(uri) ?: "application/octet-stream"
    val data = cr.openInputStream(uri)?.use { it.readBytes() } ?: return null
    SharedFile(name, mime, data)
}.getOrNull()

actual class AudioRecorder actual constructor() {
    private var recorder: MediaRecorder? = null
    private var file: File? = null

    actual suspend fun start(): Boolean {
        val ctx = AndroidPlatform.context
        if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            val ask = AndroidPlatform.requestPermission ?: return false
            if (!ask(Manifest.permission.RECORD_AUDIO)) return false
        }
        return runCatching {
            val f = File(File(ctx.cacheDir, "audio").apply { mkdirs() }, "rec-${System.currentTimeMillis()}.m4a")
            val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioSamplingRate(44100)
            r.setAudioEncodingBitRate(96_000)
            r.setOutputFile(f.path)
            r.prepare()
            r.start()
            recorder = r
            file = f
            true
        }.getOrElse { false }
    }

    actual fun pause() { runCatching { recorder?.pause() } }
    actual fun resume() { runCatching { recorder?.resume() } }

    actual fun level(): Float {
        val amp = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
        return sqrt(amp / 32767f).coerceIn(0f, 1f)
    }

    actual fun stop(): SharedFile? {
        val r = recorder ?: return null
        recorder = null
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        val f = file ?: return null
        file = null
        val data = if (ok) runCatching { f.readBytes() }.getOrNull() else null
        f.delete()
        return data?.takeIf { it.isNotEmpty() }?.let { SharedFile("recording-${System.currentTimeMillis() / 1000}.m4a", "audio/mp4", it) }
    }

    actual fun cancel() {
        recorder?.let { runCatching { it.stop() }; it.release() }
        recorder = null
        file?.delete()
        file = null
    }
}

actual fun decodeImage(bytes: ByteArray, maxPx: Int): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0) return null
    var sample = 1
    while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}

actual fun encodePng(image: ImageBitmap): ByteArray =
    ByteArrayOutputStream().also { image.asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()

actual fun appVersion(): String = runCatching {
    val ctx = AndroidPlatform.context
    ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName
}.getOrNull() ?: "?"
