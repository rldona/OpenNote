package app.opennote.sync

import dev.whyoleg.cryptography.random.CryptographyRandom
import kotlin.io.encoding.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * The other direction of the contract: this implementation writes an encrypted location with the fixtures' notes, and
 * server/test/sync-fixtures.test.ts syncs a fresh TypeScript device from it and expects the same notes back.
 */
class KotlinWritesLocationTest {
    private val device = "device-kilo-0004"

    @Test
    fun writesAnEncryptedLocationTheTypeScriptAppCanRead() {
        val expected = readJsonObject("$FIXTURES/expected.json")
        val passphrase = expected["passphrase"]!!.jsonPrimitive.content
        val source = expected["locations"]!!.jsonObject["encrypted"]!!.jsonObject
        val sourceCodec = SyncCodec(source["keyHex"]!!.jsonPrimitive.content.hexToBytes())
        val notes = source["notes"]!!.jsonArray.map { it.jsonObject }

        deleteRecursively(KOTLIN_LOCATION)
        val root = "$KOTLIN_LOCATION/location/opennote-sync"
        val salt = CryptographyRandom.nextBytes(16)
        val codec = SyncCodec(SyncCodec.deriveKey(passphrase, salt))
        val format = buildJsonObject {
            put("version", SyncFormat.VERSION)
            put("app", "opennote")
            put("encrypted", true)
            put("salt", Base64.encode(salt))
            put("verifier", Base64.encode(codec.encode("opennote".encodeToByteArray())))
        }
        writeBytes("$root/format.json", jsStringify(format).encodeToByteArray())
        val me = buildJsonObject { put("id", device); put("name", "Kotlin test"); put("lastSeenAt", 1792000000000) }
        writeBytes("$root/devices/$device.json", codec.encode(jsStringify(me).encodeToByteArray()))

        for (note in notes) {
            // Attachment bytes first (docs/SYNC-FORMAT.md 5), re-encrypted with this location's key.
            for (a in note["attachments"]!!.jsonArray) {
                val sha = a.jsonObject["sha256"]!!.jsonPrimitive.content
                val bytes = sourceCodec.decode(readBytes("$FIXTURES/encrypted/opennote-sync/attachments/${sourceCodec.blobName(sha)}"))
                assertEquals(sha, Hashing.sha256(bytes).toHex())
                writeBytes("$root/attachments/${codec.blobName(sha)}", codec.encode(bytes))
            }
            val id = note["id"]!!.jsonPrimitive.content
            val record = JsonObject(
                mapOf(
                    "v" to JsonPrimitive(SyncFormat.VERSION),
                    "id" to JsonPrimitive(id),
                    "deviceId" to JsonPrimitive(device),
                    "deviceName" to JsonPrimitive("Kotlin test"),
                    "vv" to JsonObject(mapOf(device to JsonPrimitive(1))),
                    "writtenAt" to JsonPrimitive(1792000000000),
                    "note" to note,
                ),
            )
            val bytes = SyncFormat.sealRecord(record)
            val reread = parseJson(bytes.decodeToString()).jsonObject
            assertEquals(true, SyncFormat.isValidRecord(reread, "notes/$id/$device.json"))
            writeBytes("$root/notes/$id/$device.json", codec.encode(bytes))
        }

        val meta = buildJsonObject {
            put("passphrase", passphrase)
            put("notes", source["notes"]!!)
        }
        writeBytes("$KOTLIN_LOCATION/expected.json", jsStringify(meta).encodeToByteArray())
    }
}
