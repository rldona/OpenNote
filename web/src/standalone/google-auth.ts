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
const TOKEN_KEY = 'opennote.gdrive.token';
const HINT_KEY = 'opennote.gdrive.account';
const GIS_URL = 'https://accounts.google.com/gsi/client';

/** The account that signed in, so Google does not show the account chooser again when several accounts are open in the browser. */
const loadHint = (): string | undefined => {
  try {
    return localStorage.getItem(HINT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};
const saveHint = (email: string | null) => {
  try {
    if (email) localStorage.setItem(HINT_KEY, email);
    else localStorage.removeItem(HINT_KEY);
  } catch {
    /* ignore */
  }
};

interface TokenResponse { access_token?: string; expires_in?: number; error?: string }
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(c: {
        client_id: string; scope: string; hint?: string; callback: (r: TokenResponse) => void; error_callback: (e: { type: string }) => void;
      }): { requestAccessToken(o: { prompt: '' | 'consent' }): void };
      revoke(token: string, done?: () => void): void;
    };
  };
}
const gis = () => (window as unknown as { google?: Gis }).google;

/** An access token lasts about an hour. It is kept (scope: the hidden app folder only) so a page reload does not need a new one. */
function loadToken(): { token: string; expiresAt: number } | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as { token?: unknown; expiresAt?: unknown } | null;
    return t && typeof t.token === 'string' && typeof t.expiresAt === 'number' && t.expiresAt > Date.now() ? { token: t.token, expiresAt: t.expiresAt } : null;
  } catch {
    return null;
  }
}
const saveToken = (t: { token: string; expiresAt: number } | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the token lasts until the tab closes */
  }
};

let cached: { token: string; expiresAt: number } | null = loadToken();
let inflight: Promise<string> | null = null;
let loading: Promise<void> | null = null;

export const driveConfigured = () => CLIENT_ID !== '';

/** Connected before names and pictures were kept: look the account up with the token already at hand. */
export function ensureProfile(): void {
  if (isConnected() && cached && cached.expiresAt > Date.now()) void rememberAccount(cached.token);
}

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

const PROFILE_KEY = 'opennote.gdrive.profile';
const PROFILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface DriveProfile { name: string; email: string; photo: string | null }

/** Who is signed in (name, email, picture), once known. */
export function getProfile(): DriveProfile | null {
  if (!isConnected()) return null;
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as (DriveProfile & { at?: number }) | null;
    return p && typeof p.email === 'string' ? { name: p.name ?? '', email: p.email, photo: p.photo ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Learns which Google account this is, with Drive's own "about" call (allowed with the same scope): the email is the hint
 * for the next sign-in, the name and picture show on the account button. Looked up again once a day.
 */
async function rememberAccount(token: string): Promise<void> {
  try {
    const old = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as { at?: number } | null;
    if (old?.at && Date.now() - old.at < PROFILE_MAX_AGE_MS && loadHint()) return;
  } catch {
    /* look it up */
  }
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)', { headers: { Authorization: `Bearer ${token}` } });
    const u = ((await res.json()) as { user?: { displayName?: string; emailAddress?: string; photoLink?: string } }).user;
    if (!res.ok || !u?.emailAddress) return;
    saveHint(u.emailAddress);
    const photo = u.photoLink && /^https:\/\//.test(u.photoLink) ? u.photoLink : null;
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: u.displayName ?? '', email: u.emailAddress, photo, at: Date.now() }));
    window.dispatchEvent(new Event('opennote:drive-profile'));
  } catch {
    /* only a convenience */
  }
}

function request(prompt: '' | 'consent'): Promise<string> {
  return new Promise((resolve, reject) => {
    const g = gis();
    if (!g) return reject(new Error('Google sign-in is not loaded'));
    g.accounts.oauth2
      .initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        hint: loadHint(),
        callback: (r) => {
          if (r.error || !r.access_token) return reject(new Error(r.error ?? 'no token'));
          cached = { token: r.access_token, expiresAt: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 60) * 1000 };
          saveToken(cached);
          void rememberAccount(r.access_token);
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

/**
 * The browser only opens Google's (usually invisible) renewal popup during a user gesture. When a renewal is needed in the
 * background it is blocked, so the next click or key press anywhere in the page is used to renew, and the app is told.
 */
let waitingForGesture = false;
function renewOnNextGesture(): void {
  if (waitingForGesture) return;
  waitingForGesture = true;
  window.dispatchEvent(new Event('opennote:drive-needs-click'));
  const events = ['pointerdown', 'keydown'] as const;
  const run = () => {
    for (const e of events) window.removeEventListener(e, run, true);
    waitingForGesture = false;
    // Starts inside the gesture, so the popup is allowed.
    request('').then(
      () => window.dispatchEvent(new Event('opennote:drive-renewed')),
      () => window.dispatchEvent(new Event('opennote:drive-needs-connect')),
    );
  };
  for (const e of events) window.addEventListener(e, run, true);
}

/** A valid access token for the sync engine. `force` skips the cached one (after Drive answered 401). */
export function getToken(force: boolean): Promise<string> {
  if (!isConnected()) return Promise.reject(new Error('Connect Google Drive first'));
  if (!force && cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.token);
  inflight ??= preloadGoogle()
    .then(() => request(''))
    .catch((err: Error) => {
      if (/popup_failed_to_open/.test(err.message)) {
        renewOnNextGesture();
        throw new Error('Google Drive sync paused: click anywhere in OpenNote to resume');
      }
      // Keep Google's reason (popup_closed, interaction_required, access_denied...) so a failure can be understood.
      window.dispatchEvent(new Event('opennote:drive-needs-connect'));
      throw new Error(`Google needs you to connect again (${err.message})`);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function disconnect(): void {
  const token = cached?.token;
  cached = null;
  saveToken(null);
  saveHint(null);
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
  remember(false);
  window.dispatchEvent(new Event('opennote:drive-profile'));
  if (token) gis()?.accounts.oauth2.revoke(token);
}
