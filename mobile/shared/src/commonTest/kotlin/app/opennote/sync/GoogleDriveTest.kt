package app.opennote.sync

import app.opennote.core.Database
import app.opennote.core.MemoryBlobStore
import app.opennote.core.NoteInput
import app.opennote.core.NoteStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.headersOf
import io.ktor.http.parseUrlEncodedParameters
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/** server/test/sync-gdrive.test.ts and google-oauth.test.ts, on the Kotlin transport and sign-in. */
class GoogleDriveTest {
    private fun transport(drive: FakeDrive, onToken: (Boolean) -> Unit = {}) =
        GoogleDriveTransport(drive.client, { force -> onToken(force); drive.validToken }, sleep = {})

    @Test
    fun flatFilesInTheAppDataFolderReplacedInPlace() = runTest {
        val drive = FakeDrive()
        val t = transport(drive)
        t.write("notes/a/dev.json", "one".encodeToByteArray())
        t.write("format.json", "{}".encodeToByteArray())
        assertEquals(listOf("format.json", "notes/a/dev.json"), drive.names())
        val v1 = t.list("notes/a").single().version
        t.write("notes/a/dev.json", "two".encodeToByteArray())
        assertEquals(2, drive.files.size) // same Drive file
        assertNotEquals(v1, t.list("notes/a").single().version)
        assertEquals("two", t.read("notes/a/dev.json")!!.decodeToString())
        assertEquals(listOf("notes" to "dir", "format.json" to "file"), t.list("").map { it.name to if (it.version == "dir") "dir" else "file" }.sortedByDescending { it.first })
    }

    @Test
    fun listsOncePerRunThenUsesItsIndex() = runTest {
        val drive = FakeDrive()
        repeat(5) { i -> transport(drive).write("notes/n$i/dev.json", byteArrayOf(i.toByte())) }
        drive.pageSize = 2
        drive.calls.clear()
        val t = transport(drive)
        assertEquals(5, t.list("notes").size)
        assertTrue(t.exists("notes/n3/dev.json"))
        assertNull(t.read("notes/missing/dev.json"))
        assertEquals(3, drive.calls.count { it == "GET /drive/v3/files" }) // 3 pages, then nothing more
    }

    @Test
    fun removesAndRacesOnWriteIfAbsent() = runTest {
        val drive = FakeDrive()
        val a = transport(drive); val b = transport(drive)
        a.list(""); b.list("") // both indexed while empty
        assertTrue(a.writeIfAbsent("format.json", "a".encodeToByteArray()))
        assertFalse(b.writeIfAbsent("format.json", "b".encodeToByteArray())) // b created its copy, saw a's older one, removed its own
        assertEquals(listOf("format.json"), drive.names())
        assertEquals("a", b.read("format.json")!!.decodeToString())
        a.remove("format.json"); a.remove("format.json"); a.remove("never/written")
        assertEquals(emptyList(), drive.names())
    }

    @Test
    fun resumableUploadsAboveFiveMegabytes() = runTest {
        val drive = FakeDrive()
        val t = transport(drive)
        val big = ByteArray(6 * 1024 * 1024) { (it % 251).toByte() }
        t.write("attachments/big", big)
        t.write("attachments/big", big.reversedArray())
        assertTrue(drive.calls.any { it.endsWith("?resumable") })
        assertEquals(big.reversedArray().toList(), transport(drive).read("attachments/big")!!.toList())
    }

    @Test
    fun refreshesTheTokenOnceAndBacksOffWhenThrottled() = runTest {
        val drive = FakeDrive()
        val forced = mutableListOf<Boolean>()
        var token = "stale"
        val t = GoogleDriveTransport(drive.client, { force -> forced += force; if (force) token = "good"; token }, sleep = {})
        t.write("x", byteArrayOf(1))
        assertEquals(listOf(false, true), forced.take(2))
        drive.failNext.addAll(listOf(429, 503))
        assertEquals(1, transport(drive).read("x")!!.size)
        drive.failNext.addAll(listOf(500, 500, 500, 500))
        assertContains(assertFailsWith<SyncError> { transport(drive).read("x") }.message!!, "error 500")
        drive.validToken = "rotated"
        assertContains(assertFailsWith<SyncError> { GoogleDriveTransport(drive.client, { "old" }, sleep = {}).list("") }.message!!, "connect again")
        assertFailsWith<IllegalArgumentException> { transport(drive).read("../etc/passwd") }
    }

    @Test
    fun twoPhonesSyncThroughDriveEncrypted() = runTest {
        val drive = FakeDrive()
        fun phone(name: String) = NoteStore(Database.open(":memory:"), MemoryBlobStore()).let { s ->
            s to SyncEngine(s, { transport(drive) }, name).also { it.setPassphrase("correct horse") }
        }
        val (sa, ea) = phone("iPhone"); val (sb, eb) = phone("Pixel")
        val n = sa.createNote(NoteInput(title = "Desde el iPhone", content = "<p>hola</p>"))
        sa.addAttachment(n.id, "a.bin", "application/octet-stream", byteArrayOf(4, 2))
        assertEquals(1, ea.run().pushed)
        assertEquals(1, eb.run().pulled)
        assertEquals("Desde el iPhone", sb.getNote(n.id).title)
        // Google only ever stores ciphertext.
        for (f in drive.files.values.filter { it.name != "format.json" }) {
            val text = f.data.decodeToString()
            assertFalse("hola" in text || "Desde el iPhone" in text, f.name)
        }
    }

    // ------------------------------------------------------------------ sign-in

    private class FakeGoogle {
        val requests = mutableListOf<Map<String, String>>()
        var refreshValid = true
        val client = HttpClient(MockEngine { req ->
            val form = req.body.toByteArray().decodeToString().parseUrlEncodedParameters().let { p -> p.names().associateWith { p[it]!! } }
            requests += form + ("_url" to req.url.toString())
            when {
                req.url.encodedPath.endsWith("/drive/v3/about") ->
                    if (req.headers["Authorization"]?.startsWith("Bearer a") == true) respond(
                        """{"user":{"displayName":"Ada Lovelace","emailAddress":"ada@example.com","photoLink":"https://lh3.googleusercontent.com/a/ada"}}""",
                        HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"),
                    ) else respond("{}", HttpStatusCode.Unauthorized)
                req.url.encodedPath.endsWith("/revoke") -> respond("", HttpStatusCode.OK)
                form["grant_type"] == "authorization_code" ->
                    respond("""{"access_token":"a1","expires_in":3600,"refresh_token":"r1"}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                form["grant_type"] == "refresh_token" && refreshValid ->
                    respond("""{"access_token":"a${requests.size}","expires_in":3600}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                else -> respond("""{"error":"invalid_grant"}""", HttpStatusCode.BadRequest, headersOf(HttpHeaders.ContentType, "application/json"))
            }
        })
    }

    @Test
    fun signsInWithPkceAndKeepsTheRefreshToken() = runTest {
        val g = FakeGoogle()
        val secrets = MemorySecretStore()
        var clock = 1_000_000L
        val auth = GoogleAuth(g.client, "client-id", "app.opennote:/oauth2redirect", secrets) { clock }
        val pending = auth.begin()
        val url = Url(pending.url)
        assertEquals("https://www.googleapis.com/auth/drive.appdata", url.parameters["scope"])
        assertEquals("S256", url.parameters["code_challenge_method"])
        assertEquals("app.opennote:/oauth2redirect", url.parameters["redirect_uri"])
        assertFailsWith<SyncError> { auth.complete(pending, "app.opennote:/oauth2redirect?state=forged&code=x") }
        assertContains(assertFailsWith<SyncError> { auth.complete(pending, "app.opennote:/oauth2redirect?state=${pending.state}&error=access_denied") }.message!!, "not granted")
        auth.complete(pending, "app.opennote:/oauth2redirect?state=${pending.state}&code=the-code")
        val exchange = g.requests.last()
        assertEquals("the-code", exchange["code"])
        assertEquals(pending.verifier, exchange["code_verifier"])
        assertTrue(auth.connected)
        assertEquals("a1", auth.getToken(false)) // cached
        val who = auth.fetchProfile()
        assertEquals(GoogleProfile("Ada Lovelace", "ada@example.com", "https://lh3.googleusercontent.com/a/ada"), who)
        assertEquals(who, GoogleProfile.fromJson(who!!.toJson()))
        clock += 3_600_000
        assertNotEquals("a1", auth.getToken(false)) // expired: renewed from the refresh token
        g.refreshValid = false
        assertContains(assertFailsWith<SyncError> { auth.getToken(true) }.message!!, "withdrawn")
        assertFalse(auth.connected)
    }

    @Test
    fun disconnectRevokesAndForgets() = runTest {
        val g = FakeGoogle()
        val secrets = MemorySecretStore().apply { set("sync.google.refresh", "r9") }
        val auth = GoogleAuth(g.client, "client-id", "app.opennote:/oauth2redirect", secrets)
        auth.disconnect()
        assertFalse(auth.connected)
        assertEquals("r9", g.requests.single()["token"])
    }
}
