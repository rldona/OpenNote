import { useEffect, useState } from 'react';
import { api } from './api';
import { locale, t } from './i18n';

interface Att { id: string; filename: string; mime: string; size: number }

const icon = (mime: string) =>
  mime.startsWith('image/') ? '🖼' : mime === 'application/pdf' ? '📄' : mime.startsWith('audio/') ? '🎙' : mime.startsWith('video/') ? '🎬' : mime.startsWith('text/') ? '📝' : '📎';

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const isText = (a: Att) => a.mime.startsWith('text/') || ['application/json', 'application/xml'].includes(a.mime) || /\.(md|csv|log|txt|json)$/i.test(a.filename);

/** Files attached to a note, with a preview for images, PDFs, audio, video and text. */
export function AttachmentsPanel({ noteId, refreshKey, readOnly }: { noteId: string; refreshKey: unknown; readOnly: boolean }) {
  const [atts, setAtts] = useState<Att[]>([]);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Att | null>(null);

  const load = () => api.attachments(noteId).then(setAtts).catch(() => setAtts([]));
  useEffect(() => void load(), [noteId, refreshKey]);

  if (atts.length === 0) return null;
  return (
    <div className="attachments">
      <button className="att-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        📎 {atts.length === 1 ? t('attachmentOne') : t('attachments', { n: atts.length })} {open ? '▾' : '▸'}
      </button>
      {open && (
        <ul>
          {atts.map((a) => (
            <li key={a.id}>
              <span aria-hidden>{icon(a.mime)}</span>
              <button className="att-name" onClick={() => setPreview(a)} title={t('preview')}>{a.filename}</button>
              <small>{size(a.size)}</small>
              <a href={`/api/attachments/${a.id}`} download={a.filename}>{t('download')}</a>
              {!readOnly && (
                <button
                  className="att-del"
                  aria-label={`${t('delete')} ${a.filename}`}
                  onClick={async () => {
                    if (!window.confirm(t('confirmRemoveFile'))) return;
                    await api.deleteAttachment(a.id);
                    void load();
                  }}
                >✕</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {preview && <Preview att={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function Preview({ att, onClose }: { att: Att; onClose: () => void }) {
  const url = `/api/attachments/${att.id}`;
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!isText(att) || att.size > 400_000) return;
    let cancelled = false;
    void fetch(url).then((r) => r.text()).then((x) => !cancelled && setText(x));
    return () => {
      cancelled = true;
    };
  }, [att, url]);

  let body: React.ReactNode;
  if (att.mime.startsWith('image/')) body = <img src={url} alt={att.filename} />;
  else if (att.mime === 'application/pdf') body = <iframe src={url} title={att.filename} />;
  else if (att.mime.startsWith('audio/')) body = <audio src={url} controls autoPlay />;
  else if (att.mime.startsWith('video/')) body = <video src={url} controls autoPlay />;
  else if (text !== null) body = <pre>{text}</pre>;
  else body = <p className="muted">{t('noPreview')}</p>;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal preview" role="dialog" aria-label={att.filename} onClick={(e) => e.stopPropagation()}>
        <div className="preview-head">
          <strong>{att.filename}</strong>
          <small>{att.mime} · {size(att.size)} · {new Date().toLocaleDateString(locale)}</small>
          <a href={url} download={att.filename}>{t('download')}</a>
          <button onClick={onClose}>{t('close')}</button>
        </div>
        <div className="preview-body">{body}</div>
      </div>
    </div>
  );
}
