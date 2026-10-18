import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';

interface Request {
  message: string;
  initial: string;
  resolve: (value: string | null) => void;
}

let open: ((r: Request) => void) | null = null;

/**
 * Asks for a line of text in an in-app window. `window.prompt` is not available in Electron (it returns null without
 * showing anything), so every text question goes through here. Resolves to null when cancelled.
 */
export function askText(message: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (!open) return resolve(null);
    open({ message, initial, resolve });
  });
}

/** Renders the question asked through `askText`. Mount it once. */
export function PromptHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    open = (r) => {
      setValue(r.initial);
      setReq(r);
    };
    return () => {
      open = null;
    };
  }, []);

  useEffect(() => {
    if (req) setTimeout(() => input.current?.select(), 0);
  }, [req]);

  if (!req) return null;
  const done = (result: string | null) => {
    req.resolve(result);
    setReq(null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(null)}>
      <form
        className="modal prompt"
        role="dialog"
        aria-modal="true"
        aria-label={req.message}
        onSubmit={(e) => {
          e.preventDefault();
          done(value);
        }}
        onKeyDown={(e) => e.key === 'Escape' && done(null)}
      >
        <label className="field">
          <span>{req.message}</span>
          <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </label>
        <div className="row">
          <button type="button" onClick={() => done(null)}>{t('cancel')}</button>
          <button type="submit" className="primary">{t('accept')}</button>
        </div>
      </form>
    </div>
  );
}
