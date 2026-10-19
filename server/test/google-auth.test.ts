import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Call { prompt: string; scope: string; clientId: string }

function installGoogle(behaviour: (call: Call) => { token?: string; error?: string; expires?: number } | 'popup_closed') {
  const calls: Call[] = [];
  const revoked: string[] = [];
  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.window = {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (c: { client_id: string; scope: string; callback: (r: object) => void; error_callback: (e: { type: string }) => void }) => ({
            requestAccessToken: ({ prompt }: { prompt: string }) => {
              const call = { prompt, scope: c.scope, clientId: c.client_id };
              calls.push(call);
              const r = behaviour(call);
              queueMicrotask(() => {
                if (r === 'popup_closed') c.error_callback({ type: 'popup_closed' });
                else c.callback({ access_token: r.token, error: r.error, expires_in: r.expires ?? 3600 });
              });
            },
          }),
          revoke: (t: string) => void revoked.push(t),
        },
      },
    },
  };
  return { calls, revoked, store };
}

async function load(clientId = 'test-client.apps.googleusercontent.com') {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', clientId);
  return import('../../web/src/standalone/google-auth.js');
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('Google sign-in (browser build)', () => {
  it('is off when the build has no client id', async () => {
    installGoogle(() => ({ token: 't' }));
    const auth = await load('');
    expect(auth.driveConfigured()).toBe(false);
    await expect(auth.connect()).rejects.toThrow(/not set up/);
  });

  it('connects with consent, asks only for the app-data scope, then reuses the token', async () => {
    const g = installGoogle(() => ({ token: 'tok-1' }));
    const auth = await load();
    expect(auth.isConnected()).toBe(false);
    await expect(auth.getToken(false)).rejects.toThrow(/Connect Google Drive first/);
    await auth.connect();
    expect(g.calls).toEqual([{ prompt: 'consent', scope: 'https://www.googleapis.com/auth/drive.appdata', clientId: 'test-client.apps.googleusercontent.com' }]);
    expect(auth.isConnected()).toBe(true);
    expect(await auth.getToken(false)).toBe('tok-1');
    expect(g.calls.length).toBe(1); // cached: no second request
  });

  it('renews silently when the token expired or Drive said 401, and shares one request between callers', async () => {
    let n = 0;
    const g = installGoogle(() => ({ token: `tok-${++n}` }));
    const auth = await load();
    await auth.connect();
    const [a, b, c] = await Promise.all([auth.getToken(true), auth.getToken(true), auth.getToken(true)]);
    expect([a, b, c]).toEqual(['tok-2', 'tok-2', 'tok-2']);
    expect(g.calls.map((x) => x.prompt)).toEqual(['consent', '']); // one silent request for three callers
  });

  it('asks the user to connect again when a silent renewal fails, and reports a closed popup', async () => {
    let silent = false;
    installGoogle((call) => {
      if (call.prompt === '' && silent) return 'popup_closed';
      return { token: 'tok' };
    });
    const auth = await load();
    await auth.connect();
    silent = true;
    await expect(auth.getToken(true)).rejects.toThrow(/connect again/);
    installGoogle(() => 'popup_closed');
    const auth2 = await load();
    await expect(auth2.connect()).rejects.toThrow(/cancelled/);
    expect(auth2.isConnected()).toBe(false);
  });

  it('disconnect revokes the token and forgets the connection', async () => {
    const g = installGoogle(() => ({ token: 'tok-x' }));
    const auth = await load();
    await auth.connect();
    auth.disconnect();
    expect(g.revoked).toEqual(['tok-x']);
    expect(auth.isConnected()).toBe(false);
    await expect(auth.getToken(false)).rejects.toThrow(/Connect Google Drive first/);
  });
});
