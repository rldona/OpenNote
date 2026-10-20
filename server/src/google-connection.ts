/** What the HTTP API needs to know about the Google Drive connection. Implemented by google-oauth.ts (Node). */
export interface GoogleConnection {
  /** The build has OAuth client credentials. */
  configured(): boolean;
  connected(): boolean;
  /** `waiting`: the browser sign-in was started and has not finished. */
  state(): { state: 'idle' | 'waiting' | 'error'; error?: string };
  /** Starts the sign-in and returns the address to open in the user's browser. */
  begin(): Promise<{ url: string }>;
  disconnect(): Promise<void>;
  /** Who is signed in, once known; null when not connected. */
  profile(): GoogleProfile | null;
}

/** The Google account behind the connection, from Drive's `about` call (no scope beyond `drive.appdata` needed). */
export interface GoogleProfile {
  name: string;
  email: string;
  /** Address of the account picture, or null when the account has none. */
  photo: string | null;
}

/** Reads Drive's `about?fields=user(...)` answer. */
export function parseAbout(json: unknown): GoogleProfile | null {
  const u = (json as { user?: { displayName?: unknown; emailAddress?: unknown; photoLink?: unknown } } | null)?.user;
  if (!u || typeof u.emailAddress !== 'string') return null;
  return {
    name: typeof u.displayName === 'string' ? u.displayName : '',
    email: u.emailAddress,
    photo: typeof u.photoLink === 'string' && /^https:\/\//.test(u.photoLink) ? u.photoLink : null,
  };
}

export const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)';
