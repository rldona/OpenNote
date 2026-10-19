import { useEffect, useState } from 'react';
import { api, type SyncConfig, type SyncStatus } from './api';
import { locale, t } from './i18n';
import { connect, disconnect, driveConfigured, isConnected, preloadGoogle } from './standalone/google-auth';

/** Settings and status for folder-based sync. */
export function SyncPanel({ onClose, onSynced }: { onClose: () => void; onSynced: () => void }) {
  const [cfg, setCfg] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [folder, setFolder] = useState('');
  const [interval, setIntervalMin] = useState(5);
  const [device, setDevice] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(isConnected());
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    // Load Google's script now so that a later click can open the sign-in popup immediately.
    if (__STANDALONE__ && driveConfigured()) void preloadGoogle().catch(() => undefined);
    void Promise.all([api.syncConfig(), api.syncStatus()]).then(([c, s]) => {
      setCfg(c);
      setStatus(s);
      setFolder(c.folder ?? '');
      setIntervalMin(c.intervalMinutes);
      setDevice(c.deviceName);
    });
  }, []);

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
      setStatus(await api.syncNow());
      onSynced();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setError(null);
    setSigning(true);
    try {
      await connect();
      setConnected(true);
    } catch (e) {
      setError(`${t('driveCancelled')}: ${(e as Error).message}`);
    } finally {
      setSigning(false);
    }
  };

  if (!cfg) return null;
  const remote = cfg.remote;
  const canSync = remote ? connected && (cfg.hasPassphrase || !!pass) : !!folder.trim();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sync-panel" role="dialog" aria-label={remote ? t('driveTitle') : t('syncTitle')} onClick={(e) => e.stopPropagation()}>
        <h3>{remote ? t('driveTitle') : t('syncTitle')}</h3>
        <p className="muted">{remote ? t('driveHelp') : t('syncHelp')}</p>
        {remote ? (
          !driveConfigured() ? (
            <p className="error" role="alert">{t('driveNotSetUp')}</p>
          ) : (
            <div className="row drive-connect">
              <strong>{connected ? `✓ ${t('driveConnected')}` : t('driveNotConnected')}</strong>
              {connected ? (
                <button onClick={() => { disconnect(); setConnected(false); void save({ enabled: false }); }}>{t('driveDisconnect')}</button>
              ) : (
                <button className="primary" disabled={signing} onClick={() => void signIn()}>{signing ? t('driveWorking') : t('driveConnect')}</button>
              )}
            </div>
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
            <input type="checkbox" checked={cfg.enabled} disabled={remote && !canSync} onChange={(e) => void saveAll().then((ok) => ok && save({ enabled: e.target.checked }))} />
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
