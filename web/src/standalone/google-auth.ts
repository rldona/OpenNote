/**
 * Google sign-in for the browser build, with Google Identity Services (the token flow). It only ever asks for the
 * `drive.appdata` scope: a hidden folder that belongs to this app and that no other app, and not the user's own Drive files,
 * can see. No client secret exists or is needed; the client id is public by design and comes from the build.
 *
 * Access tokens last about an hour and the token flow has no refresh token, so renewing one means asking Google again
 * (usually silent). If the browser blocks that, the sync status asks the user to connect again.
 */
const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || '';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FLAG = 'opennote.gdrive.connected';
const GIS_URL = 'https://accounts.google.com/gsi/client';

interface TokenResponse { access_token?: string; expires_in?: number; error?: string }
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(c: {
        client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback: (e: { type: string }) => void;
      }): { requestAccessToken(o: { prompt: '' | 'consent' }): void };
      revoke(token: string, done?: () => void): void;
    };
  };
}
const gis = () => (window as unknown as { google?: Gis }).google;

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;
let loading: Promise<void> | null = null;

export const driveConfigured = () => CLIENT_ID !== '';

export function isConnected(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    /* private mode: the connection lasts until the tab closes */
  }
};

/** Loads Google's script. Call it early (when the panel opens) so the later click can open the sign-in popup at once. */
export function preloadGoogle(): Promise<void> {
  if (gis()) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load Google sign-in (are you offline?)'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

function request(prompt: '' | 'consent'): Promise<string> {
  return new Promise((resolve, reject) => {
    const g = gis();
    if (!g) return reject(new Error('Google sign-in is not loaded'));
    g.accounts.oauth2
      .initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (r) => {
          if (r.error || !r.access_token) return reject(new Error(r.error ?? 'no token'));
          cached = { token: r.access_token, expiresAt: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 60) * 1000 };
          resolve(r.access_token);
        },
        error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in was cancelled' : e.type)),
      })
      .requestAccessToken({ prompt });
  });
}

/** Asks Google for access. Must run from a click, or the browser blocks the popup. */
export async function connect(): Promise<void> {
  if (!driveConfigured()) throw new Error('Google Drive sync is not set up in this build');
  await preloadGoogle();
  await request('consent');
  remember(true);
}

/** A valid access token for the sync engine. `force` skips the cached one (after Drive answered 401). */
export function getToken(force: boolean): Promise<string> {
  if (!isConnected()) return Promise.reject(new Error('Connect Google Drive first'));
  if (!force && cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.token);
  inflight ??= preloadGoogle()
    .then(() => request(''))
    .catch(() => {
      throw new Error('Google needs you to connect again');
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function disconnect(): void {
  const token = cached?.token;
  cached = null;
  remember(false);
  if (token) gis()?.accounts.oauth2.revoke(token);
}
