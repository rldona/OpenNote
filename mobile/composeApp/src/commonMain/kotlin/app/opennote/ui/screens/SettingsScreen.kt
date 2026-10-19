package app.opennote.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import kotlinx.coroutines.launch
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.ui.Accent
import app.opennote.ui.AppCore
import app.opennote.ui.LocalApp
import app.opennote.ui.ScreenHeader
import app.opennote.ui.SectionTitle
import app.opennote.ui.ThemeMode
import app.opennote.ui.ago
import app.opennote.ui.isDarkTheme
import app.opennote.ui.strings

/** Sync with Google Drive and appearance. */
@Composable
fun SettingsScreen() {
    val env = LocalApp.current
    val s = strings
    val status by env.repo.syncStatus.collectAsState()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenHeader(s.settings, back = env.nav.canGoBack)
        SectionTitle(s.sync)
        SyncSettings()
        SectionTitle(s.appearance)
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(s.theme, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val modes = listOf(ThemeMode.SYSTEM to s.themeSystem, ThemeMode.LIGHT to s.themeLight, ThemeMode.DARK to s.themeDark)
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                modes.forEachIndexed { i, (m, label) ->
                    SegmentedButton(selected = env.theme == m, onClick = { env.setAppearance(m, env.accent) }, shape = SegmentedButtonDefaults.itemShape(i, modes.size)) { Text(label) }
                }
            }
            Text(s.accent, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val dark = isDarkTheme(env.theme)
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                for (a in Accent.entries) {
                    Box(
                        Modifier.size(36.dp).clip(CircleShape).background(if (dark) a.dark else a.light)
                            .then(if (env.accent == a) Modifier.border(3.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier)
                            .clickable { env.setAppearance(env.theme, a) },
                    )
                }
            }
        }
        Text(s.storedLocally, Modifier.padding(20.dp), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SyncSettings() {
    val env = LocalApp.current
    val s = strings
    val auth = AppCore.auth
    val connected by AppCore.connected.collectAsState()
    val status by env.repo.syncStatus.collectAsState()
    val syncing by env.repo.syncing.collectAsState()
    var busy by remember { mutableStateOf(false) }
    var hasPassphrase by remember { mutableStateOf(env.repo.engine?.hasPassphrase == true) }
    var editing by remember { mutableStateOf(false) }
    var askDisconnect by remember { mutableStateOf(false) }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(s.googleDrive, fontSize = 16.sp)
        when {
            auth == null -> Text(s.driveNotConfigured, fontSize = 14.sp, color = muted)
            !connected -> {
                Text(s.driveExplain, fontSize = 14.sp, color = muted)
                Button(enabled = !busy, onClick = {
                    busy = true
                    env.scope.launch {
                        runCatching { AppCore.connectGoogle() }.onFailure { env.message(it.message ?: "$it") }
                        busy = false
                    }
                }) { Text(if (busy) s.connecting else s.connectDrive) }
            }
            else -> {
                Text(s.driveConnected, fontSize = 14.sp, color = muted)
                if (!hasPassphrase || editing) {
                    var value by remember { mutableStateOf("") }
                    OutlinedTextField(
                        value, { value = it }, Modifier.fillMaxWidth(), label = { Text(s.passphrase) }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                    )
                    Text(s.passphraseHint, fontSize = 13.sp, color = muted)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = value.isNotBlank(), onClick = {
                            val p = value
                            env.scope.launch {
                                runCatching { env.repo.write { env.repo.engine?.setPassphrase(p) } }
                                    .onFailure { env.message(it.message ?: "$it"); return@launch }
                                hasPassphrase = true
                                editing = false
                                AppCore.syncIfReady()
                            }
                        }) { Text(s.save) }
                        if (editing) TextButton(onClick = { editing = false }) { Text(s.cancel) }
                    }
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !syncing, onClick = { env.scope.launch { AppCore.syncIfReady() } }) {
                            Text(if (syncing) s.syncing else s.syncNow)
                        }
                        TextButton(onClick = { editing = true }) { Text(s.changePassphrase) }
                    }
                }
                val st = status
                if (st != null || hasPassphrase) Text(
                    when {
                        st == null -> s.passphraseSet
                        st.ok -> s.syncedAt(ago(st.lastRunAt ?: 0))
                        else -> "${s.syncProblem}: ${st.errors.firstOrNull() ?: ""}"
                    },
                    fontSize = 13.sp, color = if (st != null && !st.ok) MaterialTheme.colorScheme.error else muted,
                )
                st?.conflicts?.takeIf { it.isNotEmpty() }?.let { Text(s.conflict(it.size), fontSize = 13.sp, color = muted) }
                TextButton(onClick = { askDisconnect = true }, contentPadding = PaddingValues(0.dp)) { Text(s.disconnect) }
            }
        }
    }
    if (askDisconnect) AlertDialog(
        onDismissRequest = { askDisconnect = false },
        text = { Text(s.confirmDisconnect) },
        confirmButton = {
            TextButton(onClick = {
                askDisconnect = false
                env.scope.launch { AppCore.disconnectGoogle() }
            }) { Text(s.disconnect) }
        },
        dismissButton = { TextButton(onClick = { askDisconnect = false }) { Text(s.cancel) } },
    )
}
