import { useState } from 'react';
import { WrongPassphraseError, unlockNote, type NoteCipher } from './crypto';
import { t } from './i18n';

/** Shown instead of the editor while an encrypted note is still locked. */
export function LockedNote({ content, onUnlock }: { content: string; onUnlock: (html: string, cipher: NoteCipher) => void }) {
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="locked"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const { html, cipher } = await unlockNote(content, pass);
          onUnlock(html, cipher);
        } catch (err) {
          setError(err instanceof WrongPassphraseError ? t('wrongPass') : (err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div className="lock-icon" aria-hidden>🔒</div>
      <h2>{t('encryptedNote')}</h2>
      <p className="muted">{t('lockedHint')}</p>
      <input
        type="password"
        autoFocus
        value={pass}
        autoComplete="off"
        placeholder={t('passphrase')}
        aria-label={t('passphrase')}
        onChange={(e) => setPass(e.target.value)}
      />
      <button className="primary" type="submit" disabled={busy || !pass}>{busy ? '…' : t('unlock')}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

/** Asks for a new passphrase (twice) before locking a note. */
export function PassphraseDialog({ onConfirm, onClose }: { onConfirm: (passphrase: string) => Promise<void>; onClose: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-label={t('lockNote')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (a.length < 8) return setError(t('passphraseShort'));
          if (a !== b) return setError(t('passphraseMismatch'));
          setBusy(true);
          try {
            await onConfirm(a);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <h3>🔒 {t('lockNote')}</h3>
        <p className="muted">{t('lockWarn')}</p>
        <label className="field">{t('passphrase')}
          <input type="password" autoFocus value={a} autoComplete="new-password" onChange={(e) => setA(e.target.value)} />
        </label>
        <label className="field">{t('passphraseConfirm')}
          <input type="password" value={b} autoComplete="new-password" onChange={(e) => setB(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="primary" type="submit" disabled={busy}>{busy ? '…' : t('lockNote')}</button>
          <button type="button" onClick={onClose}>{t('close')}</button>
        </div>
      </form>
    </div>
  );
}
