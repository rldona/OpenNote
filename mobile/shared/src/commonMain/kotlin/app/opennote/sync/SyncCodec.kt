package app.opennote.sync

import dev.whyoleg.cryptography.CryptographyProvider
import dev.whyoleg.cryptography.DelicateCryptographyApi
import dev.whyoleg.cryptography.algorithms.AES
import dev.whyoleg.cryptography.random.CryptographyRandom

class SyncError(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Encryption of the files of a sync location (docs/SYNC-FORMAT.md 4): AES-256-GCM, laid out as
 * `"ONS1" · IV(12) · tag(16) · ciphertext`. With no key, files are stored as they are.
 */
class SyncCodec(private val key: ByteArray?) {
    val encrypted: Boolean get() = key != null

    private val cipher by lazy {
        CryptographyProvider.Default.get(AES.GCM).keyDecoder().decodeFromByteArrayBlocking(AES.Key.Format.RAW, key!!).cipher()
    }

    // The format fixes where the IV goes, so the IV is chosen here (fresh and random for every file) and passed in explicitly.
    @OptIn(DelicateCryptographyApi::class)
    fun encode(data: ByteArray): ByteArray {
        if (key == null) return data
        val iv = CryptographyRandom.nextBytes(12)
        // The provider returns ciphertext followed by the tag; the format puts the tag first.
        val sealed = cipher.encryptWithIvBlocking(iv, data)
        val body = sealed.copyOfRange(0, sealed.size - 16)
        val tag = sealed.copyOfRange(sealed.size - 16, sealed.size)
        return MAGIC + iv + tag + body
    }

    @OptIn(DelicateCryptographyApi::class)
    fun decode(data: ByteArray): ByteArray {
        if (key == null) return data
        if (data.size < 32 || !data.copyOfRange(0, 4).contentEquals(MAGIC)) throw SyncError("file is not encrypted")
        val iv = data.copyOfRange(4, 16)
        val tag = data.copyOfRange(16, 32)
        val body = data.copyOfRange(32, data.size)
        return try {
            cipher.decryptWithIvBlocking(iv, body + tag)
        } catch (e: Exception) {
            throw SyncError("could not decrypt (wrong passphrase or corrupted file)", e)
        }
    }

    /** Name of an attachment's file: its SHA-256, or an HMAC of it when encrypted (4.3). */
    fun blobName(sha256: String): String = if (key == null) sha256 else Hashing.hmacSha256(key, sha256.encodeToByteArray()).toHex()

    companion object {
        val MAGIC = "ONS1".encodeToByteArray()

        /** scrypt N = 2^15, r = 8, p = 1, 32 bytes (4.1). About a second: keep the result, not the passphrase. */
        fun deriveKey(passphrase: String, salt: ByteArray): ByteArray =
            Hashing.scrypt(passphrase.encodeToByteArray(), salt, 1 shl 15, 8, 1, 32)
    }
}
