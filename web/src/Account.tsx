import { useEffect, useRef, useState } from 'react';
import { api, type GoogleProfile } from './api';
import { Icon } from './Icon';
import { t } from './i18n';
import { ensureProfile, getProfile } from './standalone/google-auth';

const CHANGELOG_URL = 'https://github.com/rldona/OpenNote/blob/main/CHANGELOG.md';
const HELP_URL = 'https://github.com/rldona/OpenNote#readme';

/**
 * The Google account sync uses, when there is one: in the browser build it is kept by google-auth.ts, with the desktop app
 * and the local server it comes from the server (both read it from Drive's `about` call).
 */
export function useGoogleProfile(): GoogleProfile | null {
  const [profile, setProfile] = useState<GoogleProfile | null>(() => (__STANDALONE__ ? getProfile() : null));
  useEffect(() => {
    const read = () => {
      if (__STANDALONE__) setProfile(getProfile());
      else void api.googleStatus().then((g) => setProfile(g.profile ?? null), () => setProfile(null));
    };
    if (__STANDALONE__) ensureProfile();
    read();
    const events = ['opennote:drive-profile', 'opennote:drive-renewed', 'focus'];
    for (const e of events) window.addEventListener(e, read);
    return () => { for (const e of events) window.removeEventListener(e, read); };
  }, []);
  return profile;
}

/** A round picture of the account, or its initial, or a generic person. */
export function Avatar({ profile, size = 30 }: { profile: GoogleProfile | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [profile?.photo]);
  const style = { width: size, height: size };
  if (profile?.photo && !broken) {
    // Google's picture addresses end in the size ("=s64"): ask for one that stays sharp on high-density screens.
    const src = profile.photo.replace(/=s\d+(-c)?$/, '=s128-c');
    return <img className="avatar" style={style} src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  const initial = (profile?.name || profile?.email || '').trim().charAt(0).toUpperCase();
  return <span className="avatar avatar-plain" style={{ ...style, fontSize: size * 0.45 }}>{initial || <Icon name="user" size={Math.round(size * 0.55)} />}</span>;
}

/** The account button: who syncs, What's new, the trash and help. `up`: the menu opens above it (bottom of the icon rail). */
export function AccountButton({ onSync, onTrash, up = false }: { onSync: () => void; onTrash: () => void; up?: boolean }) {
  const profile = useGoogleProfile();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Above the button, the menu is placed on the page itself: the icon rail scrolls, so it would cut it.
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const label = profile ? `${profile.name || profile.email}` : t('account');
  return (
    <div className={`popover account${up ? ' up' : ''}`} ref={box}>
      <button className="account-btn" title={label} aria-label={label} aria-haspopup="true" aria-expanded={open} onClick={(e) => {
        if (up) {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ left: r.left, bottom: window.innerHeight - r.top + 6 });
        }
        setOpen((o) => !o);
      }}>
        <Avatar profile={profile} />
      </button>
      {open && (
        <div className="popover-panel account-panel" style={up && at ? { position: 'fixed', top: 'auto', left: at.left, bottom: at.bottom } : undefined} onClick={(e) => { if ((e.target as HTMLElement).closest('button, a')) setOpen(false); }}>
          <button className="account-head" onClick={onSync}>
            <Avatar profile={profile} size={40} />
            <span className="account-who">
              <strong>{profile ? profile.name || profile.email : t('thisDevice')}</strong>
              <small>{profile ? profile.email : t('localOnly')}</small>
            </span>
            <Icon name="chevron" size={16} />
          </button>
          <hr />
          <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer"><Icon name="bell" size={16} />{t('whatsNew')}</a>
          <button onClick={onTrash}><Icon name="trash" size={16} />{t('trash')}</button>
          <button onClick={onSync}><Icon name="sync" size={16} />{t('sync')}</button>
          <a href={HELP_URL} target="_blank" rel="noopener noreferrer"><Icon name="more" size={16} />{t('help')}</a>
        </div>
      )}
    </div>
  );
}
