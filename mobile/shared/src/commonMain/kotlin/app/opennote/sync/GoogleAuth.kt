package app.opennote.sync

import dev.whyoleg.cryptography.random.CryptographyRandom
import io.ktor.client.HttpClient
import io.ktor.client.request.forms.submitForm
import io.ktor.client.statement.bodyAsText
import io.ktor.http.Parameters
import io.ktor.http.Url
import io.ktor.http.encodeURLParameter
import io.ktor.http.isSuccess
import kotlin.io.encoding.Base64
import kotlin.time.Clock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.long

/** Where the long-lived Google permission is kept: the Keychain on iOS, the Keystore on Android, memory in tests. */
interface SecretStore {
    fun get(key: String): String?
    fun set(key: String, value: String?)
}

class MemorySecretStore : SecretStore {
    private val values = HashMap<String, String>()
    override fun get(key: String) = values[key]
    override fun set(key: String, value: String?) { if (value == null) values.remove(key) else values[key] = value }
}

/**
 * Google sign-in for the phone apps, the "installed application" way (RFC 8252), as server/src/google-oauth.ts does for the
 * desktop: the system browser (ASWebAuthenticationSession on iOS, Custom Tabs on Android) opens Google's page, Google
 * redirects to the app's own URL scheme, and the code is exchanged with PKCE for a refresh token. Mobile OAuth clients
 * have no client secret. Only `drive.appdata` is requested.
 */
class GoogleAuth(
    private val http: HttpClient,
    private val clientId: String,
    /** The app's redirect, e.g. com.googleusercontent.apps.<id>:/oauth2redirect (registered with the iOS/Android client). */
    private val redirectUri: String,
    private val secrets: SecretStore,
    private val now: () -> Long = { Clock.System.now().toEpochMilliseconds() },
) {
    /** A sign-in in progress: open [url] in the system browser, then pass the redirect it ends on to [complete]. */
    data class Pending(val url: String, internal val state: String, internal val verifier: String)

    private var access: Pair<String, Long>? = null

    val connected: Boolean get() = secrets.get(REFRESH_KEY) != null

    fun begin(): Pending {
        val verifier = b64url(CryptographyRandom.nextBytes(48))
        val state = b64url(CryptographyRandom.nextBytes(16))
        val params = listOf(
            "client_id" to clientId, "redirect_uri" to redirectUri, "response_type" to "code", "scope" to SCOPE,
            "code_challenge" to b64url(Hashing.sha256(verifier.encodeToByteArray())), "code_challenge_method" to "S256",
            "state" to state, "access_type" to "offline", "prompt" to "consent",
        )
        return Pending("$AUTH_URL?" + params.joinToString("&") { (k, v) -> "$k=${v.encodeURLParameter()}" }, state, verifier)
    }

    /** Finishes a sign-in from the URL the browser was redirected to. */
    suspend fun complete(pending: Pending, redirect: String) {
        val p = Url(redirect).parameters
        if (p["state"] != pending.state) throw SyncError("This sign-in does not belong to OpenNote")
        p["error"]?.let { throw SyncError(if (it == "access_denied") "Access was not granted" else "Google answered: $it") }
        val code = p["code"] ?: throw SyncError("Google answered without a code")
        val t = tokenRequest(
            "grant_type" to "authorization_code", "code" to code, "code_verifier" to pending.verifier, "redirect_uri" to redirectUri,
        )
        val refresh = (t["refresh_token"] as? JsonPrimitive)?.content ?: throw SyncError("Google did not return a long-lived access; try connecting again")
        secrets.set(REFRESH_KEY, refresh)
        remember(t)
    }

    /** An access token for [GoogleDriveTransport]; renewed silently from the refresh token. */
    suspend fun getToken(force: Boolean): String {
        val refresh = secrets.get(REFRESH_KEY) ?: throw SyncError("Connect Google Drive first")
        if (!force) access?.let { (token, expires) -> if (expires > now()) return token }
        return try {
            remember(tokenRequest("grant_type" to "refresh_token", "refresh_token" to refresh))
        } catch (e: SyncError) {
            if (e.message == "invalid_grant") {
                // Revoked in the Google account, or unused for six months: the stored permission is gone.
                secrets.set(REFRESH_KEY, null)
                access = null
                throw SyncError("Google Drive access was withdrawn: connect again")
            }
            throw e
        }
    }

    suspend fun disconnect() {
        val refresh = secrets.get(REFRESH_KEY)
        secrets.set(REFRESH_KEY, null)
        access = null
        // Best effort: forgetting it here is what matters.
        if (refresh != null) runCatching { http.submitForm(REVOKE_URL, Parameters.build { append("token", refresh) }) }
    }

    private fun remember(t: JsonObject): String {
        val token = t["access_token"]!!.let { (it as JsonPrimitive).content }
        access = token to now() + ((t["expires_in"] as JsonPrimitive).long - 60) * 1000
        return token
    }

    private suspend fun tokenRequest(vararg params: Pair<String, String>): JsonObject {
        val res = http.submitForm(TOKEN_URL, Parameters.build { append("client_id", clientId); params.forEach { (k, v) -> append(k, v) } })
        val body = runCatching { parseJson(res.bodyAsText()).jsonObject }.getOrDefault(JsonObject(emptyMap()))
        if (!res.status.isSuccess()) {
            val code = (body["error"] as? JsonPrimitive)?.content ?: res.status.value.toString()
            throw SyncError(if (code == "invalid_grant") "invalid_grant" else "Google sign-in failed ($code)")
        }
        return body
    }

    private fun b64url(b: ByteArray) = Base64.UrlSafe.encode(b).trimEnd('=')

    private companion object {
        const val AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
        const val TOKEN_URL = "https://oauth2.googleapis.com/token"
        const val REVOKE_URL = "https://oauth2.googleapis.com/revoke"
        const val SCOPE = "https://www.googleapis.com/auth/drive.appdata"
        const val REFRESH_KEY = "sync.google.refresh"
    }
}
