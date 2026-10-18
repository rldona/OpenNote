import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';

interface Stroke {
  color: string;
  width: number;
  points: [number, number][];
}

const COLORS = ['#111111', '#d93025', '#1a73e8', '#188038', '#f9ab00'];
const WIDTHS = [2, 5, 12];
const W = 960;
const H = 600;

/** Hand-drawing pad. Produces a PNG that the editor inserts as an image. */
export function Sketch({ onDone, onClose }: { onDone: (png: Blob) => void; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const [color, setColor] = useState(COLORS[0]!);
  const [width, setWidth] = useState(WIDTHS[1]!);
  const [eraser, setEraser] = useState(false);

  const redraw = () => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of [...strokes.current, ...(current.current ? [current.current] : [])]) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      if (s.points.length === 1) ctx.lineTo(s.points[0]![0] + 0.01, s.points[0]![1]);
      ctx.stroke();
    }
  };
  useEffect(redraw, []);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sketch" role="dialog" aria-label={t('sketch')} onClick={(e) => e.stopPropagation()}>
        <div className="sketch-tools">
          {COLORS.map((c) => (
            <button key={c} className={`swatch ${!eraser && color === c ? 'active' : ''}`} style={{ background: c }} aria-label={c} onClick={() => { setColor(c); setEraser(false); }} />
          ))}
          <button className={eraser ? 'active' : ''} onClick={() => setEraser(!eraser)} aria-pressed={eraser}>{t('eraser')}</button>
          {WIDTHS.map((w) => (
            <button key={w} className={width === w ? 'active' : ''} aria-label={`${w}px`} onClick={() => setWidth(w)}>
              <span className="dot" style={{ width: w + 2, height: w + 2 }} />
            </button>
          ))}
          <button onClick={() => { strokes.current.pop(); redraw(); }}>↶</button>
          <button onClick={() => { strokes.current = []; redraw(); }}>{t('clear')}</button>
        </div>
        <canvas
          ref={canvas}
          width={W}
          height={H}
          className="sketch-canvas"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            current.current = { color: eraser ? '#ffffff' : color, width: eraser ? width * 3 : width, points: [at(e)] };
            redraw();
          }}
          onPointerMove={(e) => {
            if (!current.current) return;
            current.current.points.push(at(e));
            redraw();
          }}
          onPointerUp={() => {
            if (current.current) strokes.current.push(current.current);
            current.current = null;
            redraw();
          }}
        />
        <div className="row">
          <button
            className="primary"
            onClick={() => canvas.current?.toBlob((b) => b && onDone(b), 'image/png')}
          >{t('insertDrawing')}</button>
          <button onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  );
}
