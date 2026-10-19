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
}
