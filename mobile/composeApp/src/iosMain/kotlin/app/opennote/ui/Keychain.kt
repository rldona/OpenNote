package app.opennote.ui

import app.opennote.sync.SecretStore
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.MemScope
import kotlinx.cinterop.alloc
import kotlinx.cinterop.convert
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryAddValue
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFMutableDictionaryRef
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.CFStringRef
import platform.CoreFoundation.CFTypeRef
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFBooleanTrue
import platform.CoreFoundation.kCFTypeDictionaryKeyCallBacks
import platform.CoreFoundation.kCFTypeDictionaryValueCallBacks
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSString
import platform.Foundation.create
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData

/**
 * Secrets in the iOS Keychain, as generic passwords of the service "app.opennote". Readable after the first unlock (so the
 * background sync can use them with the phone locked) and never copied to another device or backup.
 */
@OptIn(ExperimentalForeignApi::class)
class KeychainSecretStore(private val service: String = "app.opennote") : SecretStore {
    override fun get(key: String): String? = memScoped {
        val q = query(key, kSecReturnData to kCFBooleanTrue, kSecMatchLimit to kSecMatchLimitOne)
        val out = alloc<CFTypeRefVar>()
        if (SecItemCopyMatching(q, out.ptr) != errSecSuccess) return null
        (CFBridgingRelease(out.value) as? NSData)?.toByteArray()?.decodeToString()
    }

    override fun set(key: String, value: String?) {
        memScoped {
            SecItemDelete(query(key))
            if (value == null) return
            val status = SecItemAdd(
                query(key, kSecValueData to retained(value.encodeToByteArray().toNSData()), kSecAttrAccessible to kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly),
                null,
            )
            check(status == errSecSuccess) { "Keychain refused to save ($status)" }
        }
    }

    private fun MemScope.query(account: String, vararg extra: Pair<CFStringRef?, CFTypeRef?>): CFMutableDictionaryRef? {
        val pairs = listOf<Pair<CFStringRef?, CFTypeRef?>>(
            kSecClass to kSecClassGenericPassword, kSecAttrService to retained(service), kSecAttrAccount to retained(account),
        ) + extra
        val d = CFDictionaryCreateMutable(null, pairs.size.convert(), kCFTypeDictionaryKeyCallBacks.ptr, kCFTypeDictionaryValueCallBacks.ptr)
        for ((k, v) in pairs) CFDictionaryAddValue(d, k, v)
        defer { CFRelease(d) }
        return d
    }

    /** A Foundation object as a CF value for the query; released when the scope ends (the dictionary retains its own). */
    private fun MemScope.retained(value: Any): CFTypeRef? {
        val obj: Any = if (value is String) NSString.create(string = value) else value
        return CFBridgingRetain(obj).also { ref -> defer { CFRelease(ref) } }
    }
}
