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
   - **Test users**: add your own Google account (and any others you want to try it with). Up to 100 are allowed while the app
     is in *Testing*.
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

## Things to know

- **"Testing" mode is enough for personal use** and costs nothing. Google shows an "unverified app" screen the first time; choose
  *Advanced → continue*. Only the listed test users can sign in.
- **Opening it to everyone** means moving the consent screen to *In production*. For a non-sensitive scope Google asks for brand
  verification, which needs a homepage on a domain you can verify. A `github.io` address may not be accepted for that, in which
  case a custom domain (a few euros a year) would be the only cost in the whole project. Personal use never needs it.
- Google's token flow has no long-lived refresh token, so the browser asks Google for a fresh access token about once an hour. It
  is usually silent; if the browser blocks it, the sync status says to connect again.
- Every device must use the **same passphrase**; it is stored only in that device's browser. Losing it means the synced data
  cannot be recovered (the notes on each device are not affected).
- To revoke access at any time: <https://myaccount.google.com/permissions>. Deleting the app's hidden data is done from Google Drive
  → Settings → *Manage apps* → OpenNote → *Delete hidden app data*.
