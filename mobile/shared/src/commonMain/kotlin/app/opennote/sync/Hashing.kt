package app.opennote.sync

/**
 * SHA-256, HMAC-SHA256, PBKDF2-HMAC-SHA256 and scrypt in common Kotlin, so every platform derives the same bytes
 * (docs/SYNC-FORMAT.md 3.4, 4.1, 4.3). Tested against the fixtures written by the TypeScript implementation.
 */
object Hashing {
    fun sha256(data: ByteArray): ByteArray = Sha256().apply { update(data) }.digest()

    fun sha256Hex(text: String): String = sha256(text.encodeToByteArray()).toHex()

    fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
        val k = if (key.size > 64) sha256(key) else key
        val ipad = ByteArray(64) { i -> ((if (i < k.size) k[i].toInt() else 0) xor 0x36).toByte() }
        val opad = ByteArray(64) { i -> ((if (i < k.size) k[i].toInt() else 0) xor 0x5c).toByte() }
        val inner = Sha256().apply { update(ipad); update(data) }.digest()
        return Sha256().apply { update(opad); update(inner) }.digest()
    }

    fun pbkdf2HmacSha256(password: ByteArray, salt: ByteArray, iterations: Int, length: Int): ByteArray {
        val out = ByteArray(length)
        var block = 1
        var pos = 0
        while (pos < length) {
            val s = salt + byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte())
            var u = hmacSha256(password, s)
            val t = u.copyOf()
            repeat(iterations - 1) {
                u = hmacSha256(password, u)
                for (i in t.indices) t[i] = (t[i].toInt() xor u[i].toInt()).toByte()
            }
            val n = minOf(32, length - pos)
            t.copyInto(out, pos, 0, n)
            pos += n
            block++
        }
        return out
    }

    /** scrypt (RFC 7914). OpenNote uses N = 32768, r = 8, p = 1, 32 bytes. */
    fun scrypt(password: ByteArray, salt: ByteArray, n: Int, r: Int, p: Int, length: Int): ByteArray {
        require(n > 1 && n and (n - 1) == 0) { "N must be a power of two" }
        val blockInts = 32 * r
        val b = pbkdf2HmacSha256(password, salt, 1, p * 128 * r)
        val x = IntArray(blockInts)
        val v = IntArray(blockInts * n)
        val tmp = IntArray(16)
        val y = IntArray(blockInts)
        for (i in 0 until p) {
            val off = i * 128 * r
            for (k in 0 until blockInts) x[k] = readIntLe(b, off + k * 4)
            for (j in 0 until n) {
                x.copyInto(v, j * blockInts)
                blockMix(x, y, tmp, r)
            }
            for (j in 0 until n) {
                val idx = x[(2 * r - 1) * 16] and (n - 1)
                val base = idx * blockInts
                for (k in 0 until blockInts) x[k] = x[k] xor v[base + k]
                blockMix(x, y, tmp, r)
            }
            for (k in 0 until blockInts) writeIntLe(b, off + k * 4, x[k])
        }
        return pbkdf2HmacSha256(password, b, 1, length)
    }

    private fun blockMix(b: IntArray, y: IntArray, x: IntArray, r: Int) {
        b.copyInto(x, 0, (2 * r - 1) * 16, 2 * r * 16)
        for (i in 0 until 2 * r) {
            for (k in 0 until 16) x[k] = x[k] xor b[i * 16 + k]
            salsa20_8(x)
            // Even blocks go to the first half, odd ones to the second.
            val dst = (if (i % 2 == 0) i / 2 else r + i / 2) * 16
            x.copyInto(y, dst, 0, 16)
        }
        y.copyInto(b)
    }

    private fun salsa20_8(b: IntArray) {
        val x = b.copyOf()
        repeat(4) {
            x[4] = x[4] xor (x[0] + x[12]).rotateLeft(7); x[8] = x[8] xor (x[4] + x[0]).rotateLeft(9)
            x[12] = x[12] xor (x[8] + x[4]).rotateLeft(13); x[0] = x[0] xor (x[12] + x[8]).rotateLeft(18)
            x[9] = x[9] xor (x[5] + x[1]).rotateLeft(7); x[13] = x[13] xor (x[9] + x[5]).rotateLeft(9)
            x[1] = x[1] xor (x[13] + x[9]).rotateLeft(13); x[5] = x[5] xor (x[1] + x[13]).rotateLeft(18)
            x[14] = x[14] xor (x[10] + x[6]).rotateLeft(7); x[2] = x[2] xor (x[14] + x[10]).rotateLeft(9)
            x[6] = x[6] xor (x[2] + x[14]).rotateLeft(13); x[10] = x[10] xor (x[6] + x[2]).rotateLeft(18)
            x[3] = x[3] xor (x[15] + x[11]).rotateLeft(7); x[7] = x[7] xor (x[3] + x[15]).rotateLeft(9)
            x[11] = x[11] xor (x[7] + x[3]).rotateLeft(13); x[15] = x[15] xor (x[11] + x[7]).rotateLeft(18)
            x[1] = x[1] xor (x[0] + x[3]).rotateLeft(7); x[2] = x[2] xor (x[1] + x[0]).rotateLeft(9)
            x[3] = x[3] xor (x[2] + x[1]).rotateLeft(13); x[0] = x[0] xor (x[3] + x[2]).rotateLeft(18)
            x[6] = x[6] xor (x[5] + x[4]).rotateLeft(7); x[7] = x[7] xor (x[6] + x[5]).rotateLeft(9)
            x[4] = x[4] xor (x[7] + x[6]).rotateLeft(13); x[5] = x[5] xor (x[4] + x[7]).rotateLeft(18)
            x[11] = x[11] xor (x[10] + x[9]).rotateLeft(7); x[8] = x[8] xor (x[11] + x[10]).rotateLeft(9)
            x[9] = x[9] xor (x[8] + x[11]).rotateLeft(13); x[10] = x[10] xor (x[9] + x[8]).rotateLeft(18)
            x[12] = x[12] xor (x[15] + x[14]).rotateLeft(7); x[13] = x[13] xor (x[12] + x[15]).rotateLeft(9)
            x[14] = x[14] xor (x[13] + x[12]).rotateLeft(13); x[15] = x[15] xor (x[14] + x[13]).rotateLeft(18)
        }
        for (i in 0 until 16) b[i] += x[i]
    }

    private fun readIntLe(a: ByteArray, o: Int) =
        (a[o].toInt() and 0xFF) or ((a[o + 1].toInt() and 0xFF) shl 8) or ((a[o + 2].toInt() and 0xFF) shl 16) or ((a[o + 3].toInt() and 0xFF) shl 24)

    private fun writeIntLe(a: ByteArray, o: Int, v: Int) {
        a[o] = v.toByte(); a[o + 1] = (v ushr 8).toByte(); a[o + 2] = (v ushr 16).toByte(); a[o + 3] = (v ushr 24).toByte()
    }
}

fun ByteArray.toHex(): String {
    val hex = "0123456789abcdef"
    val sb = StringBuilder(size * 2)
    for (b in this) sb.append(hex[b.toInt() shr 4 and 0xF]).append(hex[b.toInt() and 0xF])
    return sb.toString()
}

fun String.hexToBytes(): ByteArray = ByteArray(length / 2) { i -> substring(i * 2, i * 2 + 2).toInt(16).toByte() }

/** Streaming SHA-256 (FIPS 180-4). */
internal class Sha256 {
    private val h = intArrayOf(
        0x6a09e667, -0x4498517b, 0x3c6ef372, -0x5ab00ac6, 0x510e527f, -0x64fa9774, 0x1f83d9ab, 0x5be0cd19,
    )
    private val buf = ByteArray(64)
    private var bufLen = 0
    private var total = 0L
    private val w = IntArray(64)

    fun update(data: ByteArray) {
        var i = 0
        total += data.size
        if (bufLen > 0) {
            val n = minOf(64 - bufLen, data.size)
            data.copyInto(buf, bufLen, 0, n)
            bufLen += n
            i = n
            if (bufLen == 64) { compress(buf, 0); bufLen = 0 }
        }
        while (i + 64 <= data.size) { compress(data, i); i += 64 }
        if (i < data.size) { data.copyInto(buf, 0, i, data.size); bufLen = data.size - i }
    }

    fun digest(): ByteArray {
        val bits = total * 8
        val pad = ByteArray(if (bufLen < 56) 56 - bufLen else 120 - bufLen)
        pad[0] = 0x80.toByte()
        val len = ByteArray(8) { i -> (bits ushr (56 - 8 * i)).toByte() }
        val keep = total
        update(pad); update(len)
        total = keep
        return ByteArray(32) { i -> (h[i / 4] ushr (24 - 8 * (i % 4))).toByte() }
    }

    private fun compress(b: ByteArray, o: Int) {
        for (t in 0 until 16) {
            val p = o + t * 4
            w[t] = ((b[p].toInt() and 0xFF) shl 24) or ((b[p + 1].toInt() and 0xFF) shl 16) or ((b[p + 2].toInt() and 0xFF) shl 8) or (b[p + 3].toInt() and 0xFF)
        }
        for (t in 16 until 64) {
            val s0 = w[t - 15].rotateRight(7) xor w[t - 15].rotateRight(18) xor (w[t - 15] ushr 3)
            val s1 = w[t - 2].rotateRight(17) xor w[t - 2].rotateRight(19) xor (w[t - 2] ushr 10)
            w[t] = w[t - 16] + s0 + w[t - 7] + s1
        }
        var a = h[0]; var bb = h[1]; var c = h[2]; var d = h[3]; var e = h[4]; var f = h[5]; var g = h[6]; var hh = h[7]
        for (t in 0 until 64) {
            val s1 = e.rotateRight(6) xor e.rotateRight(11) xor e.rotateRight(25)
            val ch = (e and f) xor (e.inv() and g)
            val t1 = hh + s1 + ch + K[t] + w[t]
            val s0 = a.rotateRight(2) xor a.rotateRight(13) xor a.rotateRight(22)
            val maj = (a and bb) xor (a and c) xor (bb and c)
            val t2 = s0 + maj
            hh = g; g = f; f = e; e = d + t1; d = c; c = bb; bb = a; a = t1 + t2
        }
        h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh
    }

    private companion object {
        val K = intArrayOf(
            0x428a2f98, 0x71374491, -0x4a3f0431, -0x164a245b, 0x3956c25b, 0x59f111f1, -0x6dc07d5c, -0x54e3a12b,
            -0x27f85568, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, -0x7f214e02, -0x6423f959, -0x3e640e8c,
            -0x1b64963f, -0x1041b87a, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            -0x67c1aeae, -0x57ce3993, -0x4ffcd838, -0x40a68039, -0x391ff40d, -0x2a586eb9, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, -0x7e3d36d2, -0x6d8dd37b,
            -0x5d40175f, -0x57e599b5, -0x3db47490, -0x3893ae5d, -0x2e6d17e7, -0x2966f9dc, -0xbf1ca7b, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, -0x7b3787ec, -0x7338fdf8, -0x6f410006, -0x5baf9315, -0x41065c09, -0x398e870e,
        )
    }
}
