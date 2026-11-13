# Setting up Google Drive sync (one time, by the project owner)

The code for Google Drive sync is in place. What is missing is a **Google Cloud OAuth client**, which only the project owner
can create (it is tied to a Google account). It costs nothing. Without it, the web version shows "Google Drive sync is not set
up in this build".

Sync only ever asks for the scope `https://www.googleapis.com/auth/drive.appdata`: a hidden folder that belongs to this app.
OpenNote cannot see or change the user's other files, and the notes in it are encrypted on the device before they are sent.

## Steps

1. Go to <https://console.cloud.google.com/> and create a project called **OpenNote**.
2. **APIs & Services → Library**: search for **Google Drive API** and press **Enable**.
3. **APIs & Services → OAuth consent screen** (shown as *Google Auth Platform* in newer consoles):
   - User type: **External**.
   - App name **OpenNote**, a support email, and a developer contact email.
   - **Scopes → Add or remove scopes**: add `.../auth/drive.appdata` ("See, create, and delete its own configuration data in
     your Google Drive"). It is not a sensitive scope.
   - **Branding → App domain**: application home page `https://rldona.github.io/OpenNote/`, privacy policy
     `https://rldona.github.io/OpenNote/privacy.html` (from `web/public-standalone/privacy.html`), authorised domain
     `rldona.github.io`. Leave the logo empty: uploading one requires verification. *Publish app* stays disabled until
     these are saved.
   - **Audience → Publishing status → Publish app**, so the status reads **In production**. Do this even for personal use:
     while it says *Testing*, Google expires the long-lived permission of the desktop and phone apps **after 7 days**, and they
     ask to connect again every week (see [Why it disconnects](#why-google-drive-disconnects)). With only `drive.appdata`,
     which is not a sensitive scope, publishing needs no review and no verification.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**, name *OpenNote web*.
   - **Authorised JavaScript origins**: `https://rldona.github.io` and, to try it locally, `http://localhost:8080` (add any other
     local port you use). No redirect URIs are needed.
   - Create it and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). It is public by design; there is no secret to
     keep, and none is used.
5. Give the client ID to the build, either of these:
   - Tell Claude the client ID and it runs `gh variable set GOOGLE_CLIENT_ID --body "<id>"` for you, or
   - In the GitHub repository: **Settings → Secrets and variables → Actions → Variables → New repository variable**, name
     `GOOGLE_CLIENT_ID`, value the client ID.
6. Re-run the **Pages** workflow (Actions → Pages → *Run workflow*). The site then shows **Connect Google Drive** in the sync panel.

## Desktop app and command line (a second OAuth client)

The desktop app signs in differently from the web version: it opens your normal browser, Google sends the answer back to a
one-shot listener on `127.0.0.1`, and the app keeps a long-lived token, so it keeps syncing without asking again every hour.
That needs its own client of a different type:

1. Same project, **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**, name *OpenNote desktop*. No origins or redirect URIs to fill in.
3. Copy the **Client ID** and the **Client secret**. For installed apps Google documents the secret as *not confidential*; it ships
   inside the app, and the sign-in is protected by PKCE and by the user approving it in their browser.
4. Give them to the build: tell Claude, or in the repository **Settings → Secrets and variables → Actions** create the variable
   `GOOGLE_DESKTOP_CLIENT_ID` and the secret `GOOGLE_DESKTOP_CLIENT_SECRET`. The next release's installers then include them.
5. To run the command-line version with Drive sync, set the environment variables `OPENNOTE_GOOGLE_CLIENT_ID` and
   `OPENNOTE_GOOGLE_CLIENT_SECRET` before `npm start`.

In the desktop app, open the sync panel, choose **Google Drive**, press **Connect**, approve in the browser that opens, then set the
passphrase (the same one as on your other devices) and press **Sync now**. The folder option is still there next to it.

## Android and iOS apps (two more OAuth clients)

The phone apps sign in through the system's sign-in browser (ASWebAuthenticationSession on iOS, Custom Tabs on Android) and
keep a long-lived token in the Keychain or the Keystore, like the desktop app. Mobile clients have no secret.

1. **iOS**: same project, **Credentials → Create credentials → OAuth client ID**, type **iOS**, name *OpenNote iOS*, bundle ID
   `app.opennote`. Copy the client ID. Google sends the answer back to the client ID reversed
   (`com.googleusercontent.apps.<…>:/oauth2redirect`); there is nothing else to register.
2. **Android**: type **Android**, name *OpenNote Android*, package name `app.opennote` and the SHA-1 of the signing key
   (`keytool -list -v -keystore ~/.android/debug.keystore -storepass android` for test builds; the release key's for the
   stores). After creating it, open it and under **Advanced settings** turn on **Enable custom URI scheme**: the app receives
   the answer at `app.opennote:/oauth2redirect`. Copy the client ID.
3. Give them to the build: tell Claude, or create the repository variables `GOOGLE_IOS_CLIENT_ID` and
   `GOOGLE_ANDROID_CLIENT_ID`. For local builds, put `opennote.googleIosClientId=…` and `opennote.googleAndroidClientId=…`
   in `~/.gradle/gradle.properties`, or set `OPENNOTE_GOOGLE_IOS_CLIENT_ID` / `OPENNOTE_GOOGLE_ANDROID_CLIENT_ID`.

On the phone: **More → Settings → Connect Google Drive**, approve, enter the passphrase of your other devices. The app then
syncs a few seconds after each change, when it opens and closes, and now and then in the background.

## Things to know

- **Keep the consent screen *In production*** (step 3). It costs nothing. Without verification Google may show the consent
  screen without OpenNote's name and logo, and possibly an "unverified app" notice (choose *Advanced → continue*); that is
  only cosmetic. Brand verification (name and logo) needs a homepage on a domain you can verify, which a `github.io` address
  may not be; personal use never needs it.
- Google's token flow in the browser has no long-lived refresh token, so the web version asks Google for a fresh access token
  about once an hour. If the browser blocks that while the page is in the background, sync pauses until the next click in
  OpenNote, or the sync status says to connect again. The desktop and phone apps do not have this limit.
- Every device must use the **same passphrase**; it is stored only in that device's browser. Losing it means the synced data
  cannot be recovered (the notes on each device are not affected).
- To revoke access at any time: <https://myaccount.google.com/permissions>. Deleting the app's hidden data is done from Google Drive
  → Settings → *Manage apps* → OpenNote → *Delete hidden app data*.

## Why Google Drive disconnects

| Where | What happens | Why | Fix |
| --- | --- | --- | --- |
| Desktop, Android, iOS | Asks to connect again about once a week | The consent screen is in *Testing*: Google expires refresh tokens after 7 days | Publish it (step 3), then connect once more on each device: tokens issued while in *Testing* still expire |
| Desktop, Android, iOS | Asks to connect again once | Access revoked at <https://myaccount.google.com/permissions>, the Google password changed, or the app unused for 6 months | Connect again |
| Web (GitHub Pages) | Sync pauses, "click anywhere to resume" or "connect again" | The browser token flow lasts about an hour and Google's renewal popup needs a click | Click in OpenNote; a lasting web connection would need a small token server (not built) |

When Google refuses the stored permission (`invalid_grant`), the desktop and phone apps forget it, keep the reason, and show
"connect again" (desktop: a message when the window comes to the front and the sync panel; phones: the account button and
Settings › Sync) until you connect again. Notes on the device are never affected; they sync again after reconnecting.
