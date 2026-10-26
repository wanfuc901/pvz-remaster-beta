/**
 * Touchpad gestures:
 *   1 finger move ........ move cursor (with acceleration)
 *   tap .................. left click
 *   tap, then hold + move  drag (left button held)
 *   long press ........... right click
 *   2 finger move ........ scroll
 *   2 finger tap ......... right click
 *   3 finger tap ......... Back
 */
import { useEffect, useRef, useState } from 'react';
import { Hand, MousePointerClick } from 'lucide-react';
import { local } from '../common/storage';
import { queueMove, queueScroll, send, vibrate } from './link';

const TAP_MS = 230;
const TAP_SLOP = 9;
const DOUBLE_TAP_MS = 280;
const LONG_PRESS_MS = 600;

export function getSensitivity(): number {
  const v = Number(local.get('tvwebos.remote.sens'));
  return Number.isFinite(v) && v > 0 ? v : 1.6;
}

interface Gesture {
  startTime: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastT: number;
  maxTouches: number;
  moved: number;
  dragging: boolean;
  longPressed: boolean;
}

function centroid(list: TouchList): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < list.length; i++) {
    x += list[i].clientX;
    y += list[i].clientY;
  }
  return { x: x / list.length, y: y / list.length };
}

export function Touchpad() {
  const ref = useRef<HTMLDivElement>(null);
  const [dragLock, setDragLock] = useState(false);
  const dragLockRef = useRef(false);
  dragLockRef.current = dragLock;

  useEffect(() => {
    const el = ref.current!;
    let g: Gesture | null = null;
    let lastTapEnd = 0;
    let lastTapPos = { x: 0, y: 0 };
    let longTimer: number | null = null;
    const sens = getSensitivity();

    const clearLong = () => {
      if (longTimer !== null) clearTimeout(longTimer);
      longTimer = null;
    };

    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      const c = centroid(e.touches);
      const now = performance.now();
      if (!g) {
        g = {
          startTime: now,
          startX: c.x,
          startY: c.y,
          lastX: c.x,
          lastY: c.y,
          lastT: now,
          maxTouches: e.touches.length,
          moved: 0,
          dragging: false,
          longPressed: false,
        };
        // Tap followed quickly by a touch near the same spot: start a drag.
        if (
          e.touches.length === 1 &&
          now - lastTapEnd < DOUBLE_TAP_MS &&
          Math.abs(c.x - lastTapPos.x) < 40 &&
          Math.abs(c.y - lastTapPos.y) < 40 &&
          !dragLockRef.current
        ) {
          g.dragging = true;
          send({ k: 'button', b: 0, a: 'down' });
          vibrate(8);
        } else if (e.touches.length === 1) {
          clearLong();
          longTimer = window.setTimeout(() => {
            if (g && g.moved < TAP_SLOP && g.maxTouches === 1 && !g.dragging) {
              g.longPressed = true;
              send({ k: 'button', b: 2, a: 'click' });
              vibrate(25);
            }
          }, LONG_PRESS_MS);
        }
      } else {
        g.maxTouches = Math.max(g.maxTouches, e.touches.length);
        g.lastX = c.x;
        g.lastY = c.y;
        clearLong();
      }
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!g) return;
      const c = centroid(e.touches);
      const now = performance.now();
      const dx = c.x - g.lastX;
      const dy = c.y - g.lastY;
      const dt = Math.max(1, now - g.lastT);
      g.lastX = c.x;
      g.lastY = c.y;
      g.lastT = now;
      g.moved += Math.abs(dx) + Math.abs(dy);
      if (g.moved > TAP_SLOP) clearLong();
      if (e.touches.length >= 2) {
        // Natural scrolling: content follows the fingers.
        queueScroll(-dx * 2.2, -dy * 2.2);
        return;
      }
      const speed = Math.sqrt(dx * dx + dy * dy) / dt; // px per ms
      const gain = sens * (0.7 + Math.min(speed, 2.5) * 1.5);
      queueMove(dx * gain, dy * gain);
    };

    const onEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (!g || e.touches.length > 0) return;
      clearLong();
      const now = performance.now();
      const short = now - g.startTime < TAP_MS && g.moved < TAP_SLOP;
      if (g.dragging) {
        send({ k: 'button', b: 0, a: 'up' });
        if (short) send({ k: 'button', b: 0, a: 'click' }); // double tap without moving = double click
      } else if (short && !g.longPressed) {
        if (g.maxTouches === 1) {
          send({ k: 'button', b: 0, a: 'click' });
          lastTapEnd = now;
          lastTapPos = { x: g.startX, y: g.startY };
          vibrate(6);
        } else if (g.maxTouches === 2) {
          send({ k: 'button', b: 2, a: 'click' });
          vibrate(12);
        } else {
          send({ k: 'key', key: 'Back', a: 'press' });
          vibrate(12);
        }
      }
      g = null;
    };

    // Non-passive listeners so preventDefault stops page scrolling and zoom.
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onEnd, { passive: false });

    // Mouse support (desktop browsers used as a remote).
    let mouseDown = false;
    let mouseMoved = 0;
    const onMouseDown = (e: MouseEvent) => {
      mouseDown = true;
      mouseMoved = 0;
      if (e.button === 2) send({ k: 'button', b: 2, a: 'click' });
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDown) return;
      mouseMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
      queueMove(e.movementX * sens, e.movementY * sens);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (mouseDown && e.button === 0 && mouseMoved < 5) send({ k: 'button', b: 0, a: 'click' });
      mouseDown = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      queueScroll(e.deltaX, e.deltaY);
    };
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', noMenu);
    return () => {
      clearLong();
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', noMenu);
    };
  }, []);

  // Scroll strip on the right edge: one finger scrolls.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current!;
    let lastY: number | null = null;
    const start = (e: TouchEvent) => {
      e.preventDefault();
      lastY = e.touches[0].clientY;
    };
    const move = (e: TouchEvent) => {
      e.preventDefault();
      if (lastY === null) return;
      const y = e.touches[0].clientY;
      queueScroll(0, (y - lastY) * 3);
      lastY = y;
    };
    const end = () => {
      lastY = null;
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
    };
  }, []);

  const toggleDrag = () => {
    const next = !dragLock;
    setDragLock(next);
    send({ k: 'button', b: 0, a: next ? 'down' : 'up' });
    vibrate(15);
  };

  return (
    <div className="touchpad-panel">
      <div className="touchpad-wrap">
        <div className="touchpad" ref={ref}>
          <div className="touchpad-hint">
            Chạm để nhấp · Chạm 2 lần rồi giữ để kéo
            <br />
            Hai ngón để cuộn · Giữ lâu hoặc chạm hai ngón để nhấp phải
          </div>
          {dragLock && <div className="drag-badge">Đang giữ chuột</div>}
        </div>
        <div className="scroll-strip" ref={stripRef} aria-label="Thanh cuộn">
          <span />
        </div>
      </div>
      <div className="mouse-buttons">
        <button className="r-btn" onClick={() => send({ k: 'button', b: 0, a: 'click' })}>
          <MousePointerClick /> Nhấp
        </button>
        <button className={`r-btn ${dragLock ? 'on' : ''}`} onClick={toggleDrag}>
          <Hand /> {dragLock ? 'Thả' : 'Giữ'}
        </button>
        <button className="r-btn" onClick={() => send({ k: 'button', b: 2, a: 'click' })}>
          Nhấp phải
        </button>
      </div>
    </div>
  );
}
