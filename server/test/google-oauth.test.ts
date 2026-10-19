import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { GoogleAuth } from '../src/google-oauth.js';
import { NoteStore } from '../src/store.js';
import { SyncEngine } from '../src/sync.js';
import { MemoryTransport } from '../src/sync-transport.js';
import { openTestDb } from './helpers.js';

const CLIENT = { clientId: 'desktop-client.apps.googleusercontent.com', clientSecret: 'not-really-secret' };

function meta() {
  const m = new Map<string, string>();
  return { map: m, getMeta: (k: string) => m.get(k) ?? null, setMeta: (k: string, v: string | null) => void (v === null ? m.delete(k) : m.set(k, v)) };
}

/** Google's token and revoke endpoints, with the PKCE check a real server does. */
function fakeGoogle() {
  const log: { url: string; form: Record<string, string> }[] = [];
  let challenge = '';
  const state = { refreshOk: true, noRefreshToken: false };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const form = Object.fromEntries(new URLSearchParams(init.body as URLSearchParams));
    log.push({ url, form });
    if (url.endsWith('/revoke')) return new Response('{}');
    if (form.client_id !== CLIENT.clientId || form.client_secret !== CLIENT.clientSecret) return Response.json({ error: 'invalid_client' }, { status: 401 });
    if (form.grant_type === 'authorization_code') {
      const ok = form.code === 'good-code' && createHash('sha256').update(form.code_verifier!).digest('base64url') === challenge;
      if (!ok) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: 'access-1', expires_in: 3600, ...(state.noRefreshToken ? {} : { refresh_token: 'refresh-1' }) });
    }
    if (form.grant_type === 'refresh_token') {
      if (!state.refreshOk || form.refresh_token !== 'refresh-1') return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: `access-${log.length}`, expires_in: 3600 });
    }
    return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }) as unknown as typeof fetch;
  return { fetchImpl, log, state, rememberChallenge: (c: string) => (challenge = c) };
}

/** What the user's browser does after Google's page: it visits the loopback address with the answer. */
async function browserReturns(authUrl: string, query: (state: string) => string) {
  const u = new URL(authUrl);
  const redirect = u.searchParams.get('redirect_uri')!;
  return fetch(`${redirect}?${query(u.searchParams.get('state')!)}`);
}
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe('Google sign-in for the desktop app (loopback + PKCE)', () => {
  it('asks for the app-data scope only, with PKCE and a loopback redirect, and keeps the refresh token', async () => {
    const g = fakeGoogle();
    const m = meta();
    const auth = new GoogleAuth(m, CLIENT, g.fetchImpl);
    expect(auth.configured()).toBe(true);
    expect(auth.connected()).toBe(false);

    const { url } = await auth.begin();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);
    g.rememberChallenge(u.searchParams.get('code_challenge')!);
    expect(auth.state()).toEqual({ state: 'waiting' });

    const res = await browserReturns(url, (s) => `code=good-code&state=${s}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('connected');
    await until(() => auth.connected());
    expect(m.map.get('sync.google.refresh')).toBe('refresh-1');
    expect(auth.state()).toEqual({ state: 'idle' });
    expect(await auth.getToken(false)).toBe('access-1'); // the token from the sign-in is reused
    // the loopback listener is gone once the sign-in is done
    await expect(fetch(u.searchParams.get('redirect_uri')!)).rejects.toThrow();
  });

  it('ignores an answer with the wrong state and keeps waiting for the real one', async () => {
    const g = fakeGoogle();
    const auth = new GoogleAuth(meta(), CLIENT, g.fetchImpl);
    const { url } = await auth.begin();
    g.rememberChallenge(new URL(url).searchParams.get('code_challenge')!);
    const forged = await browserReturns(url, () => 'code=good-code&state=forged');
    expect(forged.status).toBe(400);
    expect(auth.connected()).toBe(false);
    expect(auth.state()).toEqual({ state: 'waiting' });
    await browserReturns(url, (s) => `code=good-code&state=${s}`);
    await until(() => auth.connected());
    auth.close();
  });

  it('reports when the user does not grant access, or Google gives no long-lived token', async () => {
    const g = fakeGoogle();
    const auth = new GoogleAuth(meta(), CLIENT, g.fetchImpl);
    const first = await auth.begin();
    await browserReturns(first.url, (s) => `error=access_denied&state=${s}`);
    expect(auth.state()).toEqual({ state: 'error', error: 'Access was not granted' });
    expect(auth.connected()).toBe(false);

    g.state.noRefreshToken = true;
    const second = await auth.begin();
    g.rememberChallenge(new URL(second.url).searchParams.get('code_challenge')!);
    await browserReturns(second.url, (s) => `code=good-code&state=${s}`);
    await until(() => auth.state().state === 'error');
    expect(auth.state().error).toMatch(/long-lived/);
    expect(auth.connected()).toBe(false);
  });

  it('renews access tokens from the refresh token, and forgets a withdrawn permission', async () => {
    const g = fakeGoogle();
    const m = meta();
    m.setMeta('sync.google.refresh', 'refresh-1');
    const auth = new GoogleAuth(m, CLIENT, g.fetchImpl);
    const t1 = await auth.getToken(false);
    expect(await auth.getToken(false)).toBe(t1); // cached
    const t2 = await auth.getToken(true); // forced after a 401
    expect(t2).not.toBe(t1);
    g.state.refreshOk = false; // revoked in the Google account
    await expect(auth.getToken(true)).rejects.toThrow(/connect again/);
    expect(auth.connected()).toBe(false);
    await expect(auth.getToken(false)).rejects.toThrow(/Connect Google Drive first/);
  });

  it('disconnect revokes the token and forgets it; an unconfigured build refuses to start', async () => {
    const g = fakeGoogle();
    const m = meta();
    m.setMeta('sync.google.refresh', 'refresh-1');
    const auth = new GoogleAuth(m, CLIENT, g.fetchImpl);
    await auth.disconnect();
    expect(g.log.some((c) => c.url.endsWith('/revoke') && c.form.token === 'refresh-1')).toBe(true);
    expect(auth.connected()).toBe(false);
    const none = new GoogleAuth(meta(), {}, g.fetchImpl);
    expect(none.configured()).toBe(false);
    await expect(none.begin()).rejects.toThrow(/not set up/);
  });
});

describe('choosing between a folder and Google Drive', () => {
  const engine = () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'opennote-backend-'));
    const store = new NoteStore(openTestDb(), join(dataDir, 'attachments'));
    const remote = new MemoryTransport();
    return { remote, engine: new SyncEngine(store, { dataDir, allowFolder: true, transport: () => remote, remoteLabel: 'Google Drive', requireEncryption: true }) };
  };

  it('starts on the folder, can switch to the remote and back, and each needs its own settings', async () => {
    const { engine: e, remote } = engine();
    expect(e.getConfig()).toMatchObject({ canChooseBackend: true, remote: false, requireEncryption: false });
    await expect(e.run()).rejects.toThrow(/no sync folder/);
    e.setConfig({ backend: 'remote' });
    expect(e.getConfig()).toMatchObject({ remote: true, requireEncryption: true });
    await expect(e.run()).rejects.toThrow(/only stores encrypted data/); // remote needs a passphrase
    e.setConfig({ passphrase: 'a long passphrase' });
    expect((await e.run()).ok).toBe(true);
    expect((await remote.list('')).map((x) => x.name)).toContain('format.json');
    e.setConfig({ backend: 'folder' });
    expect(e.getConfig().remote).toBe(false);
    await expect(e.run()).rejects.toThrow(/no sync folder/);
    expect(() => e.setConfig({ backend: 'nonsense' as never })).toThrow(/unknown/);
  });
});

describe('Google routes of the local API', () => {
  const fake = (over: Partial<Record<string, unknown>> = {}) => {
    const calls: string[] = [];
    const conn = {
      configured: () => true,
      connected: () => false,
      state: () => ({ state: 'idle' as const }),
      begin: async () => (calls.push('begin'), { url: 'https://accounts.google.com/x' }),
      disconnect: async () => void calls.push('disconnect'),
      ...over,
    };
    const store = new NoteStore(openTestDb(), new Map() as never);
    return { calls, app: createApp(store, undefined, undefined, undefined, { google: conn }) };
  };
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, origin?: string) =>
    app.fetch(new Request(`http://localhost${path}`, { method, headers: { host: 'localhost', ...(origin ? { origin } : {}) } }));

  it('reports status, starts the sign-in and disconnects', async () => {
    const { app, calls } = fake();
    expect(await (await call(app, 'GET', '/api/sync/google')).json()).toEqual({ configured: true, connected: false, state: 'idle' });
    expect(await (await call(app, 'POST', '/api/sync/google/connect', 'http://localhost')).json()).toEqual({ url: 'https://accounts.google.com/x' });
    await call(app, 'POST', '/api/sync/google/disconnect', 'http://localhost');
    expect(calls).toEqual(['begin', 'disconnect']);
  });

  it('is protected like the rest of the API: foreign origins cannot start a sign-in', async () => {
    const { app, calls } = fake();
    const res = await call(app, 'POST', '/api/sync/google/connect', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('answers 404 where there is no Google support', async () => {
    const store = new NoteStore(openTestDb(), new Map() as never);
    const app = createApp(store);
    expect((await call(app, 'GET', '/api/sync/google')).status).toBe(404);
  });
});
