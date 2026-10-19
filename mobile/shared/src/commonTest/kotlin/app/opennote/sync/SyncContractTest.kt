package app.opennote.sync

import kotlin.io.encoding.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.measureTime
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Reads the locations written by the TypeScript implementation and checks that this one derives exactly what
 * expected.json says (docs/SYNC-FORMAT.md 6): JSON text, checksums, content hashes, scrypt keys, ids and file names.
 */
class SyncContractTest {
    private val expected = readJsonObject("$FIXTURES/expected.json")
    private val locations = expected["locations"]!!.jsonObject

    @Test
    fun jsonTextMatchesJsonStringify() {
        for (c in expected["stringify"]!!.jsonArray) {
            val json = c.jsonObject["json"]!!.jsonPrimitive.content
            assertEquals(json, jsStringify(parseJson(json)), "re-serialising $json")
            assertEquals(c.jsonObject["sha256"]!!.jsonPrimitive.content, Hashing.sha256Hex(json))
        }
    }

    @Test
    fun scryptKeysMatch() {
        for (c in expected["scrypt"]!!.jsonArray) {
            val o = c.jsonObject
            val key: ByteArray
            val took = measureTime { key = SyncCodec.deriveKey(o["passphrase"]!!.jsonPrimitive.content, o["saltHex"]!!.jsonPrimitive.content.hexToBytes()) }
            println("scrypt N=2^15 took $took")
            assertEquals(o["keyHex"]!!.jsonPrimitive.content, key.toHex())
        }
    }

    @Test
    fun derivedIdsAndBlobNamesMatch() {
        for (c in expected["derivedId"]!!.jsonArray) {
            assertEquals(c.jsonObject["id"]!!.jsonPrimitive.content, SyncFormat.derivedId(c.jsonObject["text"]!!.jsonPrimitive.content))
        }
        val key = locations["encrypted"]!!.jsonObject["keyHex"]!!.jsonPrimitive.content.hexToBytes()
        for (c in expected["blobName"]!!.jsonArray) {
            val o = c.jsonObject
            val sha = o["sha256"]!!.jsonPrimitive.content
            assertEquals(o["plain"]!!.jsonPrimitive.content, SyncCodec(null).blobName(sha))
            assertEquals(o["encrypted"]!!.jsonPrimitive.content, SyncCodec(key).blobName(sha))
        }
    }

    @Test
    fun passphraseOpensTheEncryptedLocation() {
        val format = readJsonObject("$FIXTURES/encrypted/opennote-sync/format.json")
        val key = SyncCodec.deriveKey(expected["passphrase"]!!.jsonPrimitive.content, Base64.decode(format["salt"]!!.jsonPrimitive.content))
        assertEquals(locations["encrypted"]!!.jsonObject["keyHex"]!!.jsonPrimitive.content, key.toHex())
        val verifier = SyncCodec(key).decode(Base64.decode(format["verifier"]!!.jsonPrimitive.content))
        assertEquals("opennote", verifier.decodeToString())
    }

    @Test
    fun recordsHaveTheExpectedChecksumsAndHashes() {
        for (name in listOf("plain", "encrypted")) {
            val loc = locations[name]!!.jsonObject
            val codec = SyncCodec(loc["keyHex"]?.jsonPrimitive?.content?.hexToBytes())
            val root = "$FIXTURES/$name/opennote-sync"
            val records = loc["records"]!!.jsonArray.map { it.jsonObject }
            for (r in records) {
                val path = r["path"]!!.jsonPrimitive.content
                val rec = parseJson(codec.decode(readBytes("$root/$path")).decodeToString()).jsonObject
                assertEquals(r["chk"]!!.jsonPrimitive.content, SyncFormat.checksum(rec), "$name $path checksum")
                assertTrue(SyncFormat.isValidRecord(rec, path), "$name $path valid")
                val note = rec["note"] as? JsonObject
                val hash = r["noteHash"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
                assertEquals(hash, note?.let(SyncFormat::noteHash), "$name $path noteHash")
            }
            val onDisk = listNames("$root/notes").flatMap { id -> listNames("$root/notes/$id").map { "notes/$id/$it" } }
            assertEquals(records.map { it["path"]!!.jsonPrimitive.content }.sorted(), onDisk.sorted())
            // Every attachment the notes need is there, and its bytes hash to what the note says.
            for (n in loc["notes"]!!.jsonArray) for (a in n.jsonObject["attachments"]!!.jsonArray) {
                val sha = a.jsonObject["sha256"]!!.jsonPrimitive.content
                assertEquals(sha, Hashing.sha256(codec.decode(readBytes("$root/attachments/${codec.blobName(sha)}"))).toHex())
            }
        }
    }

    @Test
    fun versionVectors() {
        fun vv(vararg p: Pair<String, Int>) = JsonObject(p.associate { it.first to JsonPrimitive(it.second) })
        assertEquals(SyncFormat.Order.EQUAL, SyncFormat.compareVV(vv("a" to 1), vv("a" to 1)))
        assertEquals(SyncFormat.Order.AFTER, SyncFormat.compareVV(vv("a" to 2), vv("a" to 1)))
        assertEquals(SyncFormat.Order.BEFORE, SyncFormat.compareVV(vv("a" to 1), vv("a" to 1, "b" to 1)))
        assertEquals(SyncFormat.Order.CONCURRENT, SyncFormat.compareVV(vv("a" to 2), vv("b" to 1)))
        assertEquals(SyncFormat.Order.EQUAL, SyncFormat.compareVV(vv(), vv()))
    }
}
