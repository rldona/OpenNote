import { useEffect, useState } from 'react';
import { api, type SyncConfig, type SyncStatus } from './api';
import { locale, t } from './i18n';

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

  useEffect(() => {
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
      folder: folder.trim() || null,
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

  if (!cfg) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sync-panel" role="dialog" aria-label={t('syncTitle')} onClick={(e) => e.stopPropagation()}>
        <h3>{t('syncTitle')}</h3>
        <p className="muted">{t('syncHelp')}</p>
        <label>
          {t('syncFolder')}
          <input value={folder} placeholder="/Users/me/Sync/OpenNote" onChange={(e) => setFolder(e.target.value)} />
        </label>
        <label>
          {t('syncDevice')}
          <input value={device} onChange={(e) => setDevice(e.target.value)} />
        </label>
        <label>
          {t('syncPass')}
          <input type="password" value={pass} autoComplete="new-password" placeholder={cfg.hasPassphrase ? t('syncPassSet') : ''} onChange={(e) => setPass(e.target.value)} />
        </label>
        <p className="muted">{t('syncPassWarn')}</p>
        {cfg.hasPassphrase && <button onClick={() => void save({ passphrase: null })}>{t('syncPassClear')}</button>}
        <div className="row">
          <label className="inline">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => void saveAll().then((ok) => ok && save({ enabled: e.target.checked }))} />
            {t('syncEnabled')}
          </label>
          <label className="inline">
            {t('syncEvery')}
            <input type="number" min={1} max={1440} value={interval} style={{ width: 70 }} onChange={(e) => setIntervalMin(Number(e.target.value))} />
          </label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy || !folder.trim()} onClick={() => void syncNow()}>
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
