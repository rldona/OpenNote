/// <reference types="vite/client" />

/** True in the browser-only build (`vite build --mode standalone`). */
declare const __STANDALONE__: boolean;

interface ImportMetaEnv {
  /** Public OAuth client id for Google Drive sync (browser build only). */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
