package app.opennote.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.opennote.ui.AndroidPlatform
import app.opennote.ui.App
import app.opennote.ui.warmUpEditor

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        AndroidPlatform.context = applicationContext
        warmUpEditor(this)
        setContent { App() }
    }
}
