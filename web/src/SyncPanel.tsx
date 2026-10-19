import { useEffect, useState } from 'react';
import { api, type GoogleInfo, type SyncConfig, type SyncStatus } from './api';
import { locale, t } from './i18n';
import { connect, disconnect, driveConfigured, isConnected, preloadGoogle } from './standalone/google-auth';

/**
 * The Google Drive connection, whichever way this build signs in: on the page itself (browser build, Google's popup) or through
 * the local server (desktop app: the system browser, then a token the server keeps).
 */
function useDrive(active: boolean) {
  const [connected, setConnected] = useState(__STANDALONE__ ? isConnected() : false);
  const [configured, setConfigured] = useState(__STANDALONE__ ? driveConfigured() : false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const g: GoogleInfo = await api.googleStatus();
    setConfigured(g.configured);
    setConnected(g.connected);
    setBusy(g.state === 'waiting');
    setError(g.state === 'error' ? g.error ?? null : null);
    return g;
  };

  useEffect(() => {
    if (!active) return;
    if (__STANDALONE__) {
      if (driveConfigured()) void preloadGoogle().catch(() => undefined); // so the click can open the popup at once
    } else {
      void refresh().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const signIn = async () => {
    setError(null);
    setBusy(true);
    try {
      if (__STANDALONE__) {
        await connect();
        setConnected(true);
        setBusy(false);
      } else {
        window.open((await api.googleConnect()).url, '_blank', 'noopener');
        // The server finishes the sign-in when Google redirects to it; wait for that.
        for (let i = 0; i < 200; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const g = await refresh();
          if (g.state !== 'waiting') break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (__STANDALONE__) disconnect();
    else await api.googleDisconnect();
    setConnected(false);
  };

  return { connected, configured, busy, error, signIn, signOut };
}

/** Settings and status for folder-based sync. */
export function SyncPanel({ onClose, onSynced }: { onClose: () => void; onSynced: (result: SyncStatus, autoEnabled: boolean) => void }) {
  const [cfg, setCfg] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [folder, setFolder] = useState('');
  const [interval, setIntervalMin] = useState(5);
  const [device, setDevice] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const drive = useDrive(!!cfg?.remote);

  useEffect(() => {
    setLoadError(null);
    Promise.all([api.syncConfig(), api.syncStatus()])
      .then(([c, s]) => {
        setCfg(c);
        setStatus(s);
        setFolder(c.folder ?? '');
        setIntervalMin(c.intervalMinutes);
        setDevice(c.deviceName);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [attempt]);

  const save = async (patch: Parameters<typeof api.setSyncConfig>[0]) => {
    setError(null);
    try {
      setCfg(await api.setSyncConfig(patch));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const saveAll = async () =>
    save({
      ...(cfg?.remote ? {} : { folder: folder.trim() || null }),
      intervalMinutes: interval,
      deviceName: device,
      ...(pass ? { passphrase: pass } : {}),
    }).then((ok) => {
      if (ok) setPass('');
      return ok;
    });

  const syncNow = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!(await saveAll())) return;
      const result = await api.syncNow();
      setStatus(result);
      if (!result.ok) return; // keep the panel open so the problem is visible
      // First good sync to a remote: from now on keep it in sync without asking again (the user can untick it).
      const autoEnabled = !!cfg?.remote && !cfg.enabled;
      if (autoEnabled) await save({ enabled: true });
      // It worked: close the panel so it is clear the notes can be used again.
      onSynced(result, autoEnabled);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loadError && !cfg) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" role="dialog" aria-label={t('syncTitle')} onClick={(e) => e.stopPropagation()}>
          <h3>{t('syncTitle')}</h3>
          <p className="error" role="alert">{loadError}</p>
          <div className="row">
            <button className="primary" onClick={() => setAttempt((n) => n + 1)}>{t('retry')}</button>
            <button onClick={onClose}>{t('close')}</button>
          </div>
        </div>
      </div>
    );
  }
  if (!cfg) return null;
  const remote = cfg.remote;
  const canSync = remote ? drive.connected && (cfg.hasPassphrase || !!pass) : !!folder.trim();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sync-panel" role="dialog" aria-label={remote ? t('driveTitle') : t('syncTitle')} onClick={(e) => e.stopPropagation()}>
        <h3>{remote ? t('driveTitle') : t('syncTitle')}</h3>
        <p className="muted">{remote ? t('driveHelp') : t('syncHelp')}</p>
        {cfg.canChooseBackend && (
          <div className="segmented backend" role="group" aria-label={t('syncTitle')}>
            {([['folder', t('backendFolder')], ['remote', t('backendDrive')]] as const).map(([value, label]) => (
              <button
                key={value}
                className={(value === 'remote') === remote ? 'active' : ''}
                aria-pressed={(value === 'remote') === remote}
                onClick={() => void save({ backend: value })}
              >{label}</button>
            ))}
          </div>
        )}
        {remote ? (
          !drive.configured ? (
            <p className="error" role="alert">{t('driveNotSetUp')}</p>
          ) : (
            <>
              <div className="row drive-connect">
                <strong>{drive.connected ? `✓ ${t('driveConnected')}` : t('driveNotConnected')}</strong>
                {drive.connected ? (
                  <button onClick={() => void drive.signOut().then(() => save({ enabled: false }))}>{t('driveDisconnect')}</button>
                ) : (
                  <button className="primary" disabled={drive.busy} onClick={() => void drive.signIn()}>{drive.busy ? t('driveWorking') : t('driveConnect')}</button>
                )}
              </div>
              {drive.busy && !__STANDALONE__ && <p className="muted">{t('driveBrowser')}</p>}
              {drive.error && <p className="error" role="alert">{drive.error}</p>}
            </>
          )
        ) : (
          <label>
            {t('syncFolder')}
            <input value={folder} placeholder="/Users/me/Sync/OpenNote" onChange={(e) => setFolder(e.target.value)} />
          </label>
        )}
        <label>
          {t('syncDevice')}
          <input value={device} onChange={(e) => setDevice(e.target.value)} />
        </label>
        <label>
          {remote ? t('drivePassLabel') : t('syncPass')}
          <input type="password" value={pass} autoComplete="new-password" placeholder={cfg.hasPassphrase ? t('syncPassSet') : ''} onChange={(e) => setPass(e.target.value)} />
        </label>
        <p className="muted">{remote ? `${t('drivePassRequired')} ${t('syncPassWarn')}` : t('syncPassWarn')}</p>
        {cfg.hasPassphrase && !remote && <button onClick={() => void save({ passphrase: null })}>{t('syncPassClear')}</button>}
        <div className="row">
          <label className="inline">
            <input
              type="checkbox"
              checked={cfg.enabled}
              disabled={remote && !canSync}
              onChange={(e) => {
                const on = e.target.checked; // read now: a controlled checkbox is reset by the time the saves finish
                void saveAll().then((ok) => ok && save({ enabled: on }));
              }}
            />
            {t('syncEnabled')}
          </label>
          <label className="inline">
            {t('syncEvery')}
            <input type="number" min={1} max={1440} value={interval} style={{ width: 70 }} onChange={(e) => setIntervalMin(Number(e.target.value))} />
          </label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy || !canSync} onClick={() => void syncNow()}>
            {busy ? t('syncRunning') : t('syncNow')}
          </button>
          <button onClick={() => void saveAll().then((ok) => ok && setError(null))}>{t('save')}</button>
          <button onClick={onClose}>{t('close')}</button>
        </div>
        {status && (
          <div className="sync-status" aria-live="polite">
            <div>
              {t('syncLast')}: {status.lastRunAt ? new Date(status.lastRunAt).toLocaleString(locale) : t('syncNever')}
              {status.lastRunAt && (status.ok ? ' ✓' : ' ⚠')}
            </div>
            {status.lastRunAt && <div>{t('syncCounts', { pushed: status.pushed, pulled: status.pulled, deleted: status.deleted })}</div>}
            {status.conflicts.length > 0 && (
              <div>
                <strong>{t('syncConflicts')}</strong>
                <ul>{status.conflicts.map((c) => <li key={c.noteId}><a href={`#/note/${c.noteId}`} onClick={onClose}>{c.title}</a></li>)}</ul>
              </div>
            )}
            {status.errors.length > 0 && (
              <div className="error">
                <strong>{t('syncErrors')}</strong>
                <ul>{status.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
