package app.opennote.android

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import app.opennote.ui.AndroidPlatform
import app.opennote.ui.AndroidSignIn
import app.opennote.ui.App
import app.opennote.ui.AppCore
import app.opennote.ui.EXTRA_NOTE_ID
import app.opennote.ui.SharedFile
import app.opennote.ui.warmUpEditor
import java.lang.ref.WeakReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    private var permissionAnswer: CompletableDeferred<Boolean>? = null
    private val askPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { permissionAnswer?.complete(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        // The screens draw under the status bar; its icons follow the app's theme (StatusBarIcons).
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        AndroidPlatform.activity = WeakReference(this)
        AndroidPlatform.requestNotifications = {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                runOnUiThread { askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
            }
        }
        AndroidPlatform.requestPermission = { permission ->
            val answer = CompletableDeferred<Boolean>()
            permissionAnswer = answer
            runOnUiThread { askPermission.launch(permission) }
            answer.await()
        }
        warmUpEditor(this)
        setContent { App() }
        if (savedInstanceState == null) handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onStart() {
        super.onStart()
        AppCore.onForeground()
    }

    override fun onResume() {
        super.onResume()
        AndroidSignIn.onResume()
    }

    override fun onPause() {
        super.onPause()
        AndroidSignIn.onPause()
    }

    override fun onStop() {
        super.onStop()
        // Send what was just typed before the app goes to the background.
        AppCore.scope.launch { AppCore.syncIfReady() }
    }

    override fun onDestroy() {
        if (AndroidPlatform.activity?.get() === this) {
            AndroidPlatform.activity = null
            AndroidPlatform.requestNotifications = null
            AndroidPlatform.requestPermission = null
        }
        super.onDestroy()
    }

    /** A tapped reminder opens its note; something shared to OpenNote becomes a note. */
    private fun handle(intent: Intent?) {
        intent ?: return
        intent.getStringExtra(EXTRA_NOTE_ID)?.let { AppCore.openNote.value = it; return }
        if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) return
        val uris = if (intent.action == Intent.ACTION_SEND) listOfNotNull(extraStream(intent))
        else extraStreams(intent)
        val files = uris.mapNotNull(::readShared)
        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        AppCore.scope.launch { AppCore.importShared(subject, text, files) }
    }

    @Suppress("DEPRECATION")
    private fun extraStream(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun extraStreams(intent: Intent): List<Uri> =
        (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM))
            .orEmpty()

    private fun readShared(uri: Uri): SharedFile? = runCatching {
        val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        } ?: uri.lastPathSegment ?: "file"
        val mime = contentResolver.getType(uri) ?: "application/octet-stream"
        val data = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        SharedFile(name, mime, data)
    }.getOrNull()
}
