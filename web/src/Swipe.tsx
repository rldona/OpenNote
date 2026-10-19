import { useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** How far a row has to travel before letting go runs its action, and how far it can be dragged. */
const THRESHOLD = 88;
const MAX = 140;

interface Side {
  label: string;
  icon: IconName;
  run: () => void;
}

/**
 * A list row that can be swiped sideways with a finger (phones): to the right for `right`, to the left for `left`. Mouse
 * pointers are ignored, the browser keeps vertical scrolling, and a swipe never also counts as a tap on the row.
 */
export function SwipeRow({ enabled, right, left, children }: { enabled: boolean; right: Side; left: Side; children: ReactNode }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);
  const swiped = useRef(false);
  if (!enabled) return <>{children}</>;

  const reset = () => {
    start.current = null;
    setDragging(false);
    setDx(0);
  };

  return (
    <div className={`swipe ${dx > 0 ? 'to-right' : dx < 0 ? 'to-left' : ''} ${Math.abs(dx) >= THRESHOLD ? 'armed' : ''}`}>
      <div className="swipe-bg" aria-hidden="true">
        <span className="swipe-r"><Icon name={right.icon} size={18} />{right.label}</span>
        <span className="swipe-l">{left.label}<Icon name={left.icon} size={18} /></span>
      </div>
      <div
        className={`swipe-fg ${dragging ? 'dragging' : ''}`}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          start.current = { x: e.clientX, y: e.clientY, horizontal: null };
          swiped.current = false;
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const mx = e.clientX - s.x;
          const my = e.clientY - s.y;
          if (s.horizontal === null) {
            if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.5) {
              s.horizontal = true;
              setDragging(true);
              e.currentTarget.setPointerCapture(e.pointerId);
            } else if (Math.abs(my) > 10) {
              start.current = null; // a scroll, not a swipe
              return;
            }
          }
          if (s.horizontal) {
            swiped.current = true;
            setDx(Math.max(-MAX, Math.min(MAX, mx)));
          }
        }}
        onPointerUp={() => {
          if (dx >= THRESHOLD) right.run();
          else if (dx <= -THRESHOLD) left.run();
          reset();
        }}
        onPointerCancel={reset}
        onClickCapture={(e) => {
          if (!swiped.current) return;
          swiped.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
}
