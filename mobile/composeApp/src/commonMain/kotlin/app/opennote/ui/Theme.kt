package app.opennote.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** The web app's themes and accents (web/src/styles.css): system / light / dark, and five accent hues. */
enum class ThemeMode { SYSTEM, LIGHT, DARK }

enum class Accent(val light: Color, val dark: Color) {
    GREEN(Color(0xFF1C8A4E), Color(0xFF6FD39A)),
    BLUE(Color(0xFF2F6FCF), Color(0xFF8DB4F5)),
    VIOLET(Color(0xFF7A4FC4), Color(0xFFB99AF0)),
    ORANGE(Color(0xFFC0602A), Color(0xFFF2A26F)),
    PINK(Color(0xFFC23A72), Color(0xFFF08DB5)),
}

private fun scheme(dark: Boolean, accent: Accent): ColorScheme = if (dark) {
    darkColorScheme(
        primary = accent.dark, onPrimary = Color(0xFF0B130E), primaryContainer = accent.dark.copy(alpha = 0.18f), onPrimaryContainer = accent.dark,
        // The selected tab's indicator in the bottom bar and the rail.
        secondaryContainer = accent.dark.copy(alpha = 0.22f), onSecondaryContainer = accent.dark,
        background = Color(0xFF151918), surface = Color(0xFF151918), surfaceContainer = Color(0xFF1D2220), surfaceContainerHigh = Color(0xFF252B29),
        surfaceContainerLow = Color(0xFF181C1B), onSurface = Color(0xFFE6EBE8), onBackground = Color(0xFFE6EBE8), surfaceVariant = Color(0xFF1D2220),
        onSurfaceVariant = Color(0xFF8F9B94), outline = Color(0xFF3A4440), outlineVariant = Color(0xFF2A312E), error = Color(0xFFFF8171),
    )
} else {
    lightColorScheme(
        primary = accent.light, onPrimary = Color.White, primaryContainer = accent.light.copy(alpha = 0.13f), onPrimaryContainer = accent.light,
        secondaryContainer = accent.light.copy(alpha = 0.16f), onSecondaryContainer = accent.light,
        background = Color.White, surface = Color.White, surfaceContainer = Color(0xFFF6F7F5), surfaceContainerHigh = Color(0xFFEEF0ED),
        surfaceContainerLow = Color(0xFFFBFBFA), onSurface = Color(0xFF1B211E), onBackground = Color(0xFF1B211E), surfaceVariant = Color(0xFFF6F7F5),
        onSurfaceVariant = Color(0xFF667069), outline = Color(0xFFC9CFC6), outlineVariant = Color(0xFFE4E7E2), error = Color(0xFFC2392B),
    )
}

@Composable
fun OpenNoteTheme(mode: ThemeMode, accent: Accent, content: @Composable () -> Unit) {
    val dark = when (mode) { ThemeMode.SYSTEM -> isSystemInDarkTheme(); ThemeMode.LIGHT -> false; ThemeMode.DARK -> true }
    MaterialTheme(colorScheme = scheme(dark, accent), content = content)
}

@Composable
fun isDarkTheme(mode: ThemeMode) = when (mode) { ThemeMode.SYSTEM -> isSystemInDarkTheme(); ThemeMode.LIGHT -> false; ThemeMode.DARK -> true }

/** The logo's green (mobile/scripts/make-icons.mjs): the new-note buttons and the Android header, whatever the accent. */
val BrandGreen = Color(0xFF00A82D)
