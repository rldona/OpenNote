package app.opennote.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import app.opennote.ui.BrandGreen
import app.opennote.ui.CHANGELOG_URL
import app.opennote.ui.HELP_URL
import app.opennote.ui.Screen
import app.opennote.ui.Section
import app.opennote.ui.SettingsPage
import app.opennote.ui.appVersion
import app.opennote.ui.icon
import app.opennote.ui.label
import app.opennote.ui.load
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

/** The settings, one row per page, and the version at the bottom. */
@Composable
fun SettingsScreen() {
    val env = LocalApp.current
    val s = strings
    val connected by AppCore.connected.collectAsState()
    val c = MaterialTheme.colorScheme
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenHeader(s.settings, back = env.nav.canGoBack)
        val rows = listOf(
            Triple(Icons.Outlined.DarkMode, s.appearance, SettingsPage.APPEARANCE) to null,
            Triple(Icons.Filled.MoreHoriz, s.navigation, SettingsPage.NAVIGATION) to null,
            Triple(Icons.Outlined.Book, s.notebooks, SettingsPage.NOTEBOOKS) to null,
            Triple(Icons.Outlined.Sync, s.syncShort, SettingsPage.SYNC) to (if (connected) s.googleDrive else s.off),
            Triple(Icons.Outlined.Info, s.about, SettingsPage.ABOUT) to null,
        )
        for ((row, detail) in rows) {
            val (icon, label, page) = row
            Row(
                Modifier.fillMaxWidth().clickable { env.nav.push(Screen.SettingsSection(page)) }.padding(start = 20.dp, end = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(icon, null, Modifier.size(24.dp))
                Column(Modifier.weight(1f).padding(start = 20.dp)) {
                    Row(Modifier.padding(vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(label, Modifier.weight(1f), fontSize = 17.sp)
                        if (detail != null) Text(detail, fontSize = 15.sp, color = c.onSurfaceVariant)
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.onSurfaceVariant)
                    }
                    HorizontalDivider(color = c.outlineVariant)
                }
            }
        }
        Text("OpenNote ${appVersion()}", Modifier.fillMaxWidth().padding(24.dp), fontSize = 14.sp, color = c.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

/** One settings page. */
@Composable
fun SettingsSectionScreen(page: SettingsPage) {
    val env = LocalApp.current
    val s = strings
    val title = when (page) {
        SettingsPage.APPEARANCE -> s.appearance; SettingsPage.NAVIGATION -> s.customizeNav; SettingsPage.NOTEBOOKS -> s.notebooks
        SettingsPage.SYNC -> s.sync; SettingsPage.ABOUT -> s.about
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenHeader(title, back = true)
        when (page) {
            SettingsPage.APPEARANCE -> AppearanceSettings()
            SettingsPage.NAVIGATION -> NavigationSettings()
            SettingsPage.NOTEBOOKS -> NotebookSettings()
            SettingsPage.SYNC -> { Box(Modifier.padding(top = 8.dp)) { SyncSettings() } }
            SettingsPage.ABOUT -> AboutSettings()
        }
        Spacer(Modifier.height(32.dp))
    }
}

@Composable
private fun AppearanceSettings() {
    val env = LocalApp.current
    val s = strings
    Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
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
}

/** Which sections the bottom bar shows: a preview, then every section with an eye to show or hide it. */
@Composable
private fun NavigationSettings() {
    val env = LocalApp.current
    val s = strings
    val c = MaterialTheme.colorScheme
    Text(s.preview, Modifier.padding(start = 20.dp, top = 8.dp, bottom = 10.dp), fontSize = 18.sp, fontWeight = FontWeight.Bold)
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(14.dp)).background(c.surfaceContainer).padding(vertical = 14.dp)) {
        for (sec in env.sections + listOf<Section?>(null)) {
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(sec?.icon() ?: Icons.Filled.MoreHoriz, null, tint = c.onSurfaceVariant)
                Text(sec?.label() ?: s.more, fontSize = 13.sp, color = c.onSurfaceVariant, maxLines = 1)
            }
        }
    }
    Text(s.customizeSections, Modifier.padding(start = 20.dp, top = 24.dp), fontSize = 18.sp, fontWeight = FontWeight.Bold)
    Text(s.customizeHint, Modifier.padding(horizontal = 20.dp, vertical = 6.dp), fontSize = 14.sp, color = c.onSurfaceVariant)
    val ordered = env.sections + Section.entries.filter { it !in env.sections }
    for (sec in ordered) {
        val shown = sec in env.sections
        val tint = if (shown) c.primary else c.onSurfaceVariant
        Row(
            Modifier.fillMaxWidth().clickable(enabled = sec != Section.NOTES) {
                when {
                    shown -> env.setSections(env.sections - sec)
                    env.sections.size < Section.IN_BAR -> env.setSections(env.sections + sec)
                    else -> env.message(s.customizeHint)
                }
            }.padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(sec.icon(), null, tint = tint)
            Text(sec.label(), Modifier.weight(1f).padding(start = 16.dp), fontSize = 17.sp, color = if (shown) c.primary else c.onSurfaceVariant)
            Icon(
                when { sec == Section.NOTES -> Icons.Outlined.Lock; shown -> Icons.Outlined.Visibility; else -> Icons.Outlined.VisibilityOff },
                null, tint = if (sec == Section.NOTES) c.onSurfaceVariant else tint,
            )
        }
    }
}

/** Where new notes go when nothing else says. */
@Composable
private fun NotebookSettings() {
    val env = LocalApp.current
    val s = strings
    val notebooks = load { read { listNotebooks() } } ?: return
    Text(s.defaultNotebook, Modifier.padding(start = 20.dp, top = 8.dp), fontSize = 18.sp, fontWeight = FontWeight.Bold)
    Text(s.defaultNotebookHint, Modifier.padding(horizontal = 20.dp, vertical = 6.dp), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val current = env.defaultNotebook?.takeIf { id -> notebooks.any { it.id == id } }
    for (nb in notebooks) {
        val picked = if (current == null) nb == notebooks.first() else nb.id == current
        Row(Modifier.fillMaxWidth().clickable { env.setDefaultNotebook(nb.id) }.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            RadioButton(picked, { env.setDefaultNotebook(nb.id) })
            Text(listOfNotNull(nb.stack, nb.name).joinToString(" › "), Modifier.weight(1f), fontSize = 16.sp)
            Text("${nb.noteCount}", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 8.dp))
        }
    }
}

@Composable
private fun AboutSettings() {
    val s = strings
    val uri = LocalUriHandler.current
    Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            app.opennote.ui.AppLogo(Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(BrandGreen))
            Column(Modifier.padding(start = 14.dp)) {
                Text("OpenNote", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text("${s.version} ${appVersion()}", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text(s.aboutText, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        for ((label, url) in listOf(s.whatsNew to CHANGELOG_URL, s.help to HELP_URL, s.webApp to "https://rldona.github.io/OpenNote/", s.sourceCode to "https://github.com/rldona/OpenNote")) {
            TextButton(onClick = { runCatching { uri.openUri(url) } }, contentPadding = PaddingValues(0.dp)) { Text(label) }
        }
        Text(s.storedLocally, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
