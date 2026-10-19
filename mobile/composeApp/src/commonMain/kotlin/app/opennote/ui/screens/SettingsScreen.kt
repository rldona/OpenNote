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
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.opennote.ui.Accent
import app.opennote.ui.LocalApp
import app.opennote.ui.ScreenHeader
import app.opennote.ui.SectionTitle
import app.opennote.ui.ThemeMode
import app.opennote.ui.ago
import app.opennote.ui.isDarkTheme
import app.opennote.ui.strings

/** Sync (Google Drive, once phones can sign in) and appearance. */
@Composable
fun SettingsScreen() {
    val env = LocalApp.current
    val s = strings
    val status by env.repo.syncStatus.collectAsState()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenHeader(s.settings, back = env.nav.canGoBack)
        SectionTitle(s.sync)
        Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(s.googleDrive, fontSize = 16.sp)
            Text(s.driveComingSoon, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = {}, enabled = false) { Text(s.connectDrive) }
            val st = status
            Text(
                when {
                    st == null -> s.notSyncing
                    st.ok -> s.syncedAt(ago(st.lastRunAt ?: 0))
                    else -> "${s.syncProblem}: ${st.errors.firstOrNull() ?: ""}"
                },
                fontSize = 13.sp, color = if (st != null && !st.ok) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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
