package app.opennote.ui

import platform.Foundation.NSApplicationSupportDirectory
import platform.Foundation.NSFileManager
import platform.Foundation.NSLocale
import platform.Foundation.NSSearchPathForDirectoriesInDomains
import platform.Foundation.NSUserDomainMask
import platform.Foundation.preferredLanguages
import platform.UIKit.UIDevice

@OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
actual fun appDataDir(): String {
    val base = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, true).first() as String
    val dir = "$base/OpenNote"
    NSFileManager.defaultManager.createDirectoryAtPath(dir, withIntermediateDirectories = true, attributes = null, error = null)
    return dir
}

// The user's preferred language, not currentLocale: that one only offers the localizations the bundle declares.
actual fun deviceLanguage(): String = (NSLocale.preferredLanguages.firstOrNull() as? String)?.substringBefore('-') ?: "en"
actual fun deviceModelName(): String = UIDevice.currentDevice.name
actual val showsBrandHeader: Boolean = false
