/**
 * Google sign-in for the desktop app and the command line, the "installed application" way: the system browser opens Google's
 * page, Google redirects to a one-shot server on 127.0.0.1, the code is exchanged (PKCE) for a refresh token, and from then on
 * access tokens are renewed silently, so unlike the browser build nothing needs to be clicked again after an hour.
 *
 * Only the `drive.appdata` scope is requested: OpenNote's hidden folder, never the user's own files. The refresh token is kept
 * in the local database next to the other sync settings.
 *
 * Desktop OAuth clients come with a "client secret" that Google itself documents as not confidential for installed apps, so
 * it ships inside the app.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GoogleConnection } from './google-connection.js';
import type { NoteStore } from './store.js';
import { SyncError } from './sync.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const REFRESH_KEY = 'sync.google.refresh';
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

const b64url = (b: Buffer) => b.toString('base64url');
const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>OpenNote</title><body style="font:16px system-ui;max-width:32em;margin:15vh auto;padding:0 1em"><h2>${title}</h2><p>${text}</p>`;

export class GoogleAuth implements GoogleConnection {
  private access: { token: string; expiresAt: number } | null = null;
  private pending: { server: Server; timer: ReturnType<typeof setTimeout> } | null = null;
  private lastError: string | undefined;

  constructor(
    private readonly store: Pick<NoteStore, 'getMeta' | 'setMeta'>,
    private readonly client: Partial<GoogleClient>,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  configured(): boolean {
    return !!this.client.clientId && !!this.client.clientSecret;
  }

  connected(): boolean {
    return !!this.store.getMeta(REFRESH_KEY);
  }

  state(): { state: 'idle' | 'waiting' | 'error'; error?: string } {
    if (this.pending) return { state: 'waiting' };
    return this.lastError ? { state: 'error', error: this.lastError } : { state: 'idle' };
  }

  private async tokenRequest(params: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
    const res = await this.doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.client.clientId!, client_secret: this.client.clientSecret!, ...params }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = String(body.error ?? res.status);
      throw new SyncError(code === 'invalid_grant' ? 'invalid_grant' : `Google sign-in failed (${code})`);
    }
    return body as never;
  }

  /** Opens the loopback listener and returns the Google address the user has to visit. */
  async begin(): Promise<{ url: string }> {
    if (!this.configured()) throw new SyncError('Google Drive sync is not set up in this build');
    this.cancel();
    this.lastError = undefined;
    const verifier = b64url(randomBytes(48));
    const state = b64url(randomBytes(16));

    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const reply = (status: number, html: string) => res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      if (u.searchParams.get('state') !== state) return reply(400, page('Something is wrong', 'This sign-in does not belong to OpenNote. Close this tab.'));
      const error = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      if (error || !code) {
        // Answer first: finishing closes the listener, and the browser must still receive this page.
        reply(200, page('Not connected', 'OpenNote was not given access. You can close this tab and try again.'));
        res.once('close', () => this.finish(error === 'access_denied' ? 'Access was not granted' : `Google answered: ${error ?? 'no code'}`));
        return;
      }
      void this.tokenRequest({
        grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri(),
      }).then(
        (t) => {
          if (!t.refresh_token) return this.finish('Google did not return a long-lived access; try connecting again');
          this.store.setMeta(REFRESH_KEY, t.refresh_token);
          this.access = { token: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
          this.finish();
        },
        (e: Error) => this.finish(e.message),
      );
      reply(200, page('OpenNote is connected to Google Drive', 'You can close this tab and go back to OpenNote.'));
    });
    const redirectUri = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth2callback`;
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const timer = setTimeout(() => this.finish('The sign-in took too long'), SIGN_IN_TIMEOUT_MS);
    timer.unref?.();
    this.pending = { server, timer };

    const url = new URL(AUTH_URL);
    for (const [k, v] of Object.entries({
      client_id: this.client.clientId!, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPE,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      state, access_type: 'offline', prompt: 'consent',
    })) url.searchParams.set(k, v);
    return { url: url.toString() };
  }

  /** Ends the pending sign-in (success when `error` is absent). */
  private finish(error?: string): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.server.close();
      this.pending.server.closeIdleConnections?.(); // never cut a response that is still being sent
      this.pending = null;
    }
    this.lastError = error;
  }

  private cancel(): void {
    this.finish();
  }

  /** Stops a pending sign-in (the app is closing). */
  close(): void {
    this.cancel();
  }

  /** An access token for the Drive transport. */
  async getToken(force: boolean): Promise<string> {
    const refresh = this.store.getMeta(REFRESH_KEY);
    if (!refresh) throw new SyncError('Connect Google Drive first');
    if (!force && this.access && this.access.expiresAt > Date.now()) return this.access.token;
    try {
      const t = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
      this.access = { token: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
      return t.access_token;
    } catch (err) {
      if (err instanceof SyncError && err.message === 'invalid_grant') {
        // Revoked in the Google account, or unused for six months: the stored permission is gone.
        this.store.setMeta(REFRESH_KEY, null);
        this.access = null;
        throw new SyncError('Google Drive access was withdrawn: connect again');
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    const refresh = this.store.getMeta(REFRESH_KEY);
    this.cancel();
    this.store.setMeta(REFRESH_KEY, null);
    this.access = null;
    this.lastError = undefined;
    if (refresh) {
      // Best effort: the local forgetting above is what matters.
      await this.doFetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refresh }),
      }).catch(() => undefined);
    }
  }
}
